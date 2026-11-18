'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePermission, authorizeStaff } = require('../src/middlewares/auth');
const staffRoles = require('../src/domains/admin/staffRole.service');
const { DEFAULT_ROLES, PERMISSION_KEYS, isKnownPermission } = require('../src/domains/admin/permissions');
const adminSchemas = require('../src/domains/admin/admin.management.validation');

staffRoles.__setCacheForTests([
  { key: 'finance', permissions: ['transactions.view', 'treasury.allocate'] },
  { key: 'support', permissions: ['players.view', 'chat.agent', 'not.a.real.permission'] },
]);

const staff = (adminLevel) => ({ role: 'admin', isStaff: true, adminLevel });
const mfa = { sub: 'u1', mfa: true };

const run = (middleware, req) => new Promise((resolve) => {
  middleware({ method: 'GET', originalUrl: '/x', get: () => null, ...req }, {}, (err) => resolve(err || null));
});

test('a role passes when it holds the permission', async () => {
  assert.equal(await run(requirePermission('treasury.allocate'), { user: staff('finance'), authClaims: mfa }), null);
});

test('a role is refused when it lacks the permission', async () => {
  const err = await run(requirePermission('players.delete'), { user: staff('finance'), authClaims: mfa });
  assert.equal(err?.statusCode, 403);
});

test('any one of several permissions is enough', async () => {
  assert.equal(await run(requirePermission('chat.supervise', 'chat.agent'), { user: staff('support'), authClaims: mfa }), null);
});

test('super admin holds every permission without a stored role', async () => {
  assert.equal(await run(requirePermission('freebets.manage'), { user: staff('super_admin'), authClaims: mfa }), null);
  assert.deepEqual(await staffRoles.permissionsFor('super_admin'), PERMISSION_KEYS);
});

test('unknown roles get no permissions', async () => {
  const err = await run(requirePermission('players.view'), { user: staff('deleted_role'), authClaims: mfa });
  assert.equal(err?.statusCode, 403);
});

test('permission checks still require the SMS-verified staff token', async () => {
  const err = await run(requirePermission('transactions.view'), { user: staff('finance'), authClaims: { sub: 'u1' } });
  assert.equal(err?.statusCode, 403);
});

test('players are refused even with a permission name that exists', async () => {
  const err = await run(requirePermission('players.view'), { user: { role: 'user' }, authClaims: mfa });
  assert.equal(err?.statusCode, 403);
});

test('stored permissions that are not in the catalog are ignored', async () => {
  assert.deepEqual(await staffRoles.permissionsFor('support'), ['players.view', 'chat.agent']);
});

test('authorizeStaff with no levels accepts any staff role', async () => {
  assert.equal(await run(authorizeStaff(), { user: staff('marketing'), authClaims: mfa }), null);
});

test('default roles only use known permissions', () => {
  for (const role of DEFAULT_ROLES) {
    assert.ok(role.permissions.every(isKnownPermission), role.key);
  }
  assert.deepEqual(DEFAULT_ROLES.map((r) => r.key), ['super_admin', 'admin', 'support', 'finance', 'risk', 'marketing']);
});

test('staff schemas accept custom role keys and reject malformed ones', () => {
  assert.equal(adminSchemas.manageStaff.parse({ adminLevel: 'finance' }).adminLevel, 'finance');
  assert.equal(adminSchemas.manageStaff.parse({ adminLevel: 'vip_desk_2' }).adminLevel, 'vip_desk_2');
  assert.throws(() => adminSchemas.manageStaff.parse({ adminLevel: 'Bad Role!' }));
});

test('role names become safe keys', () => {
  assert.equal(staffRoles.slugify('VIP Desk'), 'vip_desk');
  assert.equal(staffRoles.slugify('  2nd line support '), 'r_2nd_line_support');
});

test('role schemas reject unknown fields', () => {
  assert.throws(() => adminSchemas.createRole.parse({ name: 'VIP', permissions: [], system: true }));
  assert.throws(() => adminSchemas.updateRole.parse({}));
});
