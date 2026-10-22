'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { loadConfig } = require('./config');
const { createLogger } = require('./lib/logger');
const { AppError, notFound, unauthorized, tooManyRequests } = require('./lib/errors');
const { Store } = require('./store/store');
const { AuditLog } = require('./store/audit-log');
const { createVault } = require('./security/vault');
const { RequestLimiter } = require('./security/rate-limiter');
const { createUserService } = require('./services/users');
const { createHardwareService } = require('./services/hardware');
const { createLicenseService } = require('./services/licenses');
const { createNotificationService } = require('./services/notifications');
const { createComplianceService } = require('./services/compliance');
const { createAlertService } = require('./services/alerts');
const { createReportService } = require('./services/reports');
const { createProcurementService } = require('./services/procurement');
const { buildRoutes, authorize } = require('./routes');
const { readJsonBody } = require('./http/body');
const { applySecurityHeaders, send, sendJson, sendProblem } = require('./http/respond');
const { serveStatic } = require('./http/static');

const DEFAULT_BODY_LIMIT = 100 * 1024;
const SHUTDOWN_GRACE_MS = 5000;
const VERSION = require('../package.json').version;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Composes the application: configuration, persistence, services, routing and
 * the HTTP(S) server. Returns handles used by src/index.js and the tests.
 */
function createApp(overrides = {}) {
  const config = loadConfig(process.env, overrides);
  const logger = overrides.logger || createLogger(config.logLevel);
  const store = new Store({ file: config.dataFile, persistDelayMs: config.persistDelayMs, logger });
  const loaded = store.load();
  const audit = new AuditLog(store, config.now);
  const vault = createVault(config.licenseKeySecret);

  const services = {};
  const ctx = { store, audit, config, vault, services, logger };
  services.users = createUserService(ctx);
  services.notifications = createNotificationService(ctx);
  services.hardware = createHardwareService(ctx);
  services.licenses = createLicenseService(ctx);
  services.compliance = createComplianceService(ctx);
  services.alerts = createAlertService(ctx);
  services.reports = createReportService(ctx);
  services.procurement = createProcurementService(ctx);

  const seeded = services.users.seedDemoUsers();
  services.compliance.seedBlacklist();
  if (config.generatedSecrets.length) {
    logger.warn('Using ephemeral generated secrets; set them via environment variables for persistent deployments', {
      secrets: config.generatedSecrets
    });
  }

  const router = buildRoutes(services, { audit });
  if (typeof overrides.configureRouter === 'function') overrides.configureRouter(router, ctx);
  const apiLimiter = new RequestLimiter({ limit: config.rateLimitPerMinute, windowMs: 60 * 1000, now: config.now });
  const tls = Boolean(config.tlsCertFile && config.tlsKeyFile);
  const state = { ready: false, shuttingDown: false };

  function health(pathname) {
    if (pathname === '/health/live') return { status: 200, body: { status: 'UP', version: VERSION, uptimeSeconds: Math.round(process.uptime()) } };
    if (pathname === '/health/ready') {
      const checks = {
        store: 'UP',
        persistence: store.file ? (store.lastSaveError ? 'DOWN' : 'UP') : 'IN_MEMORY',
        accepting: state.ready && !state.shuttingDown ? 'UP' : 'DOWN'
      };
      const ok = checks.persistence !== 'DOWN' && checks.accepting === 'UP';
      return { status: ok ? 200 : 503, body: { status: ok ? 'READY' : 'NOT_READY', checks } };
    }
    return null;
  }

  function authenticateAgent(req) {
    const key = req.headers['x-agent-key'];
    if (!key || !safeEqual(key, config.agentApiKey)) throw unauthorized('Missing or invalid agent key');
    return { id: null, username: 'endpoint-agent', role: 'AGENT' };
  }

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    const headerId = String(req.headers['x-request-id'] || '');
    const requestId = /^[A-Za-z0-9-]{8,64}$/.test(headerId) ? headerId : crypto.randomUUID();
    const ip = req.socket.remoteAddress || 'unknown';
    let pathname = '/';
    let user = null;
    res.setHeader('X-Request-Id', requestId);
    applySecurityHeaders(res, { tls });

    try {
      const url = new URL(req.url, 'http://localhost');
      pathname = url.pathname;

      const probe = health(pathname);
      if (probe) {
        sendJson(res, probe.status, probe.body, { 'Cache-Control': 'no-store' });
        return;
      }
      if (!pathname.startsWith('/api/')) {
        if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;
        throw notFound();
      }

      res.setHeader('Cache-Control', 'no-store');
      const limit = apiLimiter.hit(ip);
      if (!limit.allowed) throw tooManyRequests('Rate limit exceeded', limit.retryAfterSeconds);

      const match = router.match(req.method, pathname);
      if (!match) throw notFound(`No route for ${req.method} ${pathname}`);
      if (match.methodNotAllowed) {
        res.setHeader('Allow', match.allowed.join(', '));
        throw new AppError(405, 'Method Not Allowed', `Use one of: ${match.allowed.join(', ')}`);
      }
      const { route, params } = match;

      if (route.options.auth === 'agent') user = authenticateAgent(req);
      else if (route.options.auth !== 'public') {
        user = services.users.authenticate(req.headers.authorization);
        authorize(route, user);
      }

      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
        ? await readJsonBody(req, route.options.bodyLimit || DEFAULT_BODY_LIMIT)
        : undefined;
      const actor = user ? { ...user, ip } : null;
      const result = await route.handler({ req, params, query: url.searchParams, body, user, actor, ip, requestId });

      if (result.raw !== undefined) send(res, result.status || 200, result.raw, result.contentType, result.headers);
      else sendJson(res, result.status || 200, result.body, result.headers);
    } catch (err) {
      if (err instanceof AppError) {
        if (err.status === 413) res.setHeader('Connection', 'close');
        sendProblem(res, err, pathname, requestId);
      } else {
        logger.error('Unhandled error', { requestId, error: err.message, stack: err.stack });
        sendProblem(res, { status: 500, title: 'Internal Server Error', detail: 'An unexpected error occurred' }, pathname, requestId);
      }
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', { requestId, method: req.method, path: pathname, status: res.statusCode, durationMs: Math.round(durationMs * 100) / 100, userId: user?.id || null, ip });
    }
  }

  const handler = (req, res) => {
    handle(req, res).catch((err) => {
      logger.error('Request handler crashed', { error: err.message });
      if (!res.headersSent) sendProblem(res, { status: 500, title: 'Internal Server Error', detail: 'An unexpected error occurred' }, req.url, null);
    });
  };

  // TLS file paths come from operator configuration, not from requests.
  /* eslint-disable security/detect-non-literal-fs-filename */
  const tlsOptions = tls
    ? { cert: fs.readFileSync(config.tlsCertFile), key: fs.readFileSync(config.tlsKeyFile), minVersion: 'TLSv1.3' }
    : null;
  /* eslint-enable security/detect-non-literal-fs-filename */
  const server = tls ? https.createServer(tlsOptions, handler) : http.createServer(handler);
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;

  let redirectServer = null;

  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (tls && config.httpRedirectPort !== null) {
      // PRJ-SR-001: plain HTTP is only ever answered with a redirect to HTTPS.
      redirectServer = http.createServer((req, res) => {
        const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
        res.writeHead(301, { Location: `https://${host}:${address.port}${req.url}` });
        res.end();
      });
      await new Promise((resolve) => redirectServer.listen(config.httpRedirectPort, config.host, resolve));
    }
    if (config.scheduleJobs) services.alerts.startScheduler(logger);
    state.ready = true;
    logger.info('IT Infrastructure Management Software started', {
      version: VERSION,
      port: address.port,
      tls,
      dataFile: store.file,
      restoredFromDisk: loaded,
      demoUsersSeeded: seeded
    });
    return { port: address.port, redirectPort: redirectServer ? redirectServer.address().port : null };
  }

  /** Graceful shutdown: stop accepting, drain in-flight requests, persist. */
  async function stop() {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    services.alerts.stopScheduler();
    const closing = new Promise((resolve) => server.close(() => resolve()));
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    const force = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    if (redirectServer) redirectServer.close();
    await closing;
    clearTimeout(force);
    store.flushSync();
    logger.info('Shutdown complete');
  }

  return { config, logger, store, audit, services, server, router, start, stop, handler };
}

module.exports = { createApp, VERSION };
