'use strict';

const crypto = require('node:crypto');

const DEFAULT_DEMO_PASSWORD = 'ChangeMe!2026';

function intEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid integer configuration value: ${value}`);
  return n;
}

/**
 * Builds the runtime configuration from environment variables, with explicit
 * overrides taking precedence (used by the test suite).
 */
function loadConfig(env = process.env, overrides = {}) {
  const config = {
    nodeEnv: env.NODE_ENV || 'development',
    port: intEnv(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    jwtSecret: env.JWT_SECRET || null,
    licenseKeySecret: env.LICENSE_KEY_SECRET || null,
    agentApiKey: env.AGENT_API_KEY || null,
    dataFile: env.DATA_FILE || null,
    backupDir: env.BACKUP_DIR || null,
    backupSecret: env.BACKUP_SECRET || null,
    tlsCertFile: env.TLS_CERT_FILE || null,
    tlsKeyFile: env.TLS_KEY_FILE || null,
    httpRedirectPort: env.HTTP_REDIRECT_PORT ? intEnv(env.HTTP_REDIRECT_PORT, null) : null,
    rateLimitPerMinute: intEnv(env.RATE_LIMIT_PER_MINUTE, 600),
    loginMaxFailures: 5,
    loginWindowMs: 60 * 1000,
    loginLockoutMs: 15 * 60 * 1000,
    tokenTtlSeconds: 15 * 60,
    seedDemoUsers: env.SEED_DEMO_USERS !== 'false',
    demoPassword: env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD,
    logLevel: env.LOG_LEVEL || 'info',
    scheduleJobs: env.SCHEDULE_JOBS !== 'false',
    persistDelayMs: 200,
    now: () => Date.now(),
    ...overrides
  };

  const generated = [];
  for (const key of ['jwtSecret', 'licenseKeySecret', 'agentApiKey']) {
    if (!config[key]) {
      if (config.nodeEnv === 'production') {
        throw new Error(`Missing required secret configuration: ${key}`);
      }
      config[key] = crypto.randomBytes(32).toString('base64url');
      generated.push(key);
    }
  }
  config.generatedSecrets = generated;
  return config;
}

module.exports = { loadConfig, DEFAULT_DEMO_PASSWORD };
