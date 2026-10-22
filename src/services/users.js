'use strict';

const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('../security/passwords');
const { signToken, verifyToken } = require('../security/jwt');
const { FailureLimiter } = require('../security/rate-limiter');
const { validate } = require('../lib/validate');
const { unauthorized, tooManyRequests } = require('../lib/errors');

/** Demo accounts, one per role, created on first start (see README). */
const DEMO_USERS = [
  ['superadmin', 'SUPER_ADMIN', 'EMP-0001', 'Sam Superadmin', 'IT'],
  ['itadmin', 'IT_ADMIN', 'EMP-0002', 'Ira Admin', 'IT'],
  ['technician', 'IT_TECHNICIAN', 'EMP-0003', 'Tara Technician', 'IT'],
  ['manager', 'MANAGER', 'EMP-0004', 'Manu Manager', 'Engineering'],
  ['director', 'IT_DIRECTOR', 'EMP-0005', 'Dev Director', 'IT'],
  ['finance', 'FINANCE_OFFICER', 'EMP-0006', 'Fiona Finance', 'Finance'],
  ['auditor', 'AUDITOR', 'EMP-0007', 'Arun Auditor', 'Compliance'],
  ['employee', 'EMPLOYEE', 'EMP-0101', 'Esha Employee', 'Engineering'],
  ['employee2', 'EMPLOYEE', 'EMP-0102', 'Eli Employee', 'Engineering']
];

const LOGIN_SCHEMA = {
  username: { type: 'string', required: true, maxLength: 64 },
  password: { type: 'string', required: true, maxLength: 128 }
};

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  employeeId: u.employeeId,
  fullName: u.fullName,
  role: u.role,
  department: u.department,
  active: u.active
});

function createUserService({ store, audit, config }) {
  const perAccount = new FailureLimiter({
    maxFailures: config.loginMaxFailures,
    windowMs: config.loginWindowMs,
    lockoutMs: config.loginLockoutMs,
    now: config.now
  });
  // Coarser per-IP limit stops one client spraying many usernames.
  const perIp = new FailureLimiter({
    maxFailures: config.loginMaxFailures * 4,
    windowMs: config.loginWindowMs,
    lockoutMs: config.loginLockoutMs,
    now: config.now
  });
  const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));

  function seedDemoUsers() {
    if (!config.seedDemoUsers || store.count('users') > 0) return 0;
    const nowIso = new Date(config.now()).toISOString();
    for (const [username, role, employeeId, fullName, department] of DEMO_USERS) {
      store.insert('users', {
        id: crypto.randomUUID(),
        username,
        role,
        employeeId,
        fullName,
        department,
        email: `${username}@itim.local`,
        active: true,
        passwordHash: hashPassword(config.demoPassword),
        createdAt: nowIso
      });
    }
    return DEMO_USERS.length;
  }

  function login(body, ip) {
    const { username, password } = validate(body, LOGIN_SCHEMA);
    const accountKey = `${ip}|${username.toLowerCase()}`;
    const locked = Math.max(perAccount.lockedFor(accountKey), perIp.lockedFor(ip));
    if (locked > 0) {
      throw tooManyRequests('Too many failed login attempts. Try again later.', Math.ceil(locked / 1000));
    }

    const user = store.findBy('users', 'username', username);
    // Always run scrypt so response time does not reveal whether the user exists.
    const passwordOk = verifyPassword(password, user ? user.passwordHash : dummyHash);
    if (!user || !user.active || !passwordOk) {
      const nowLocked = perAccount.recordFailure(accountKey);
      perIp.recordFailure(ip);
      audit.append({
        actor: { id: user?.id, username, role: user?.role, ip },
        action: nowLocked ? 'LOGIN_LOCKOUT' : 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id || null
      });
      throw unauthorized('Invalid username or password');
    }

    perAccount.reset(accountKey);
    const accessToken = signToken({ sub: user.id, role: user.role, username: user.username }, config.jwtSecret, {
      expiresInSeconds: config.tokenTtlSeconds,
      now: config.now()
    });
    audit.append({ actor: { ...user, ip }, action: 'LOGIN_SUCCESS', entityType: 'User', entityId: user.id });
    return { accessToken, tokenType: 'Bearer', expiresIn: config.tokenTtlSeconds, user: publicUser(user) };
  }

  /**
   * Resolves the caller from the Authorization header. The role is read from
   * the user record, not trusted from the token, so revoking or changing a
   * role takes effect immediately.
   */
  function authenticate(authorizationHeader) {
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorizationHeader || '');
    if (!match) throw unauthorized('Missing or malformed Authorization header');
    let claims;
    try {
      claims = verifyToken(match[1], config.jwtSecret, { now: config.now() });
    } catch (err) {
      throw unauthorized(err.message);
    }
    const user = store.get('users', claims.sub);
    if (!user || !user.active) throw unauthorized('Account is disabled or no longer exists');
    return { id: user.id, username: user.username, role: user.role, employeeId: user.employeeId };
  }

  const listUsers = () => store.all('users').map(publicUser);

  /** Minimal, non-sensitive listing of active people for assignment pickers. */
  const directory = () =>
    store
      .all('users')
      .filter((u) => u.active)
      .map((u) => ({ employeeId: u.employeeId, fullName: u.fullName, department: u.department }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const findActiveEmployee = (employeeId) => {
    const user = store.findBy('users', 'employeeId', employeeId);
    return user && user.active ? publicUser(user) : null;
  };

  return { seedDemoUsers, login, authenticate, listUsers, directory, findActiveEmployee, publicUser };
}

module.exports = { createUserService, DEMO_USERS };
