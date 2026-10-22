'use strict';

const ROLES = Object.freeze([
  'SUPER_ADMIN',
  'IT_ADMIN',
  'IT_TECHNICIAN',
  'MANAGER',
  'IT_DIRECTOR',
  'FINANCE_OFFICER',
  'AUDITOR',
  'EMPLOYEE'
]);

const ADMINS = ['SUPER_ADMIN', 'IT_ADMIN'];
const IT_STAFF = [...ADMINS, 'IT_TECHNICIAN'];

/** Permission -> roles allowed. The single source of truth for RBAC (PRJ-SR-002). */
const PERMISSIONS = Object.freeze({
  'asset:create': ADMINS,
  'asset:read': [...IT_STAFF, 'AUDITOR'],
  'asset:assign': IT_STAFF,
  'asset:maintain': IT_STAFF,
  'asset:decommission': ADMINS,
  'license:manage': ADMINS,
  'license:read': [...IT_STAFF, 'AUDITOR'],
  'license:allocate': IT_STAFF,
  'license:reveal-key': ['SUPER_ADMIN'],
  'compliance:read': [...ADMINS, 'AUDITOR'],
  'compliance:manage': ADMINS,
  'alerts:run': ADMINS,
  'notifications:read': [...ADMINS, 'AUDITOR'],
  'procurement:request': ROLES.filter((r) => r !== 'AUDITOR'),
  'procurement:read-all': [...ADMINS, 'MANAGER', 'IT_DIRECTOR', 'FINANCE_OFFICER', 'AUDITOR'],
  'procurement:approve': ['MANAGER', 'IT_DIRECTOR', 'FINANCE_OFFICER'],
  'procurement:order': ['FINANCE_OFFICER'],
  'procurement:receive': IT_STAFF,
  'audit:read': ['SUPER_ADMIN', 'AUDITOR'],
  'admin:users': ['SUPER_ADMIN'],
  'dashboard:read': ROLES
});

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission: ${permission}`);
  return allowed.includes(role);
}

module.exports = { ROLES, PERMISSIONS, can };
