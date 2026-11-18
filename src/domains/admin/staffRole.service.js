'use strict';

const StaffRole = require('./staffRole.model');
const User = require('../user/user.model');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const {
  PERMISSIONS,
  PERMISSION_KEYS,
  DEFAULT_ROLES,
  SUPER_ADMIN,
  isKnownPermission,
} = require('./permissions');

// Roles are read on every staff request, so keep them in memory briefly.
// Edits made through this process clear the cache straight away; other API
// instances pick changes up within CACHE_TTL_MS.
const CACHE_TTL_MS = 30 * 1000;
let cache = null;
let cacheLoadedAt = 0;
let loading = null;

const invalidate = () => {
  cache = null;
  cacheLoadedAt = 0;
};

const cleanPermissions = (permissions = []) =>
  [...new Set(permissions)].filter(isKnownPermission);

const loadRoles = async () => {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;
  if (!loading) {
    loading = StaffRole.find().lean()
      .then((roles) => {
        cache = new Map(roles.map((role) => [role.key, role]));
        cacheLoadedAt = Date.now();
        return cache;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
};

const permissionsFor = async (roleKey) => {
  if (!roleKey) return [];
  if (roleKey === SUPER_ADMIN) return [...PERMISSION_KEYS];
  const roles = await loadRoles();
  return cleanPermissions(roles.get(roleKey)?.permissions);
};

const roleExists = async (roleKey) => {
  if (roleKey === SUPER_ADMIN) return true;
  return (await loadRoles()).has(roleKey);
};

const assertRoleExists = async (roleKey) => {
  if (!(await roleExists(roleKey))) throw ApiError.badRequest(`Unknown staff role: ${roleKey}`);
};

// Adds any built-in role that is missing. Never overwrites a role a super
// admin has already edited.
const ensureDefaultRoles = async () => {
  const result = await StaffRole.bulkWrite(
    DEFAULT_ROLES.map((role) => ({
      updateOne: {
        filter: { key: role.key },
        update: { $setOnInsert: { ...role, system: true } },
        upsert: true,
      },
    }))
  );
  if (result.upsertedCount) logger.info(`Seeded ${result.upsertedCount} default staff role(s)`);
  invalidate();
};

const toPublicRole = (role, staffCount = 0) => ({
  key: role.key,
  name: role.name,
  description: role.description || '',
  permissions: role.key === SUPER_ADMIN ? [...PERMISSION_KEYS] : cleanPermissions(role.permissions),
  system: Boolean(role.system),
  locked: role.key === SUPER_ADMIN,
  staffCount,
  updatedAt: role.updatedAt,
});

const listRoles = async () => {
  const [roles, counts] = await Promise.all([
    StaffRole.find().sort({ system: -1, createdAt: 1 }).lean(),
    User.aggregate([
      { $match: { isStaff: true, deletedAt: null } },
      { $group: { _id: '$adminLevel', count: { $sum: 1 } } },
    ]),
  ]);
  const countByRole = new Map(counts.map((row) => [row._id, row.count]));
  return {
    roles: roles.map((role) => toPublicRole(role, countByRole.get(role.key) || 0)),
    permissions: PERMISSIONS,
  };
};

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'r_$1')
    .slice(0, 40);

const createRole = async ({ name, description, permissions }) => {
  const base = slugify(name);
  if (base.length < 2) throw ApiError.badRequest('Role name must contain letters or numbers');

  let key = base;
  for (let n = 2; await StaffRole.exists({ key }); n += 1) {
    key = `${base.slice(0, 36)}_${n}`;
  }

  const role = await StaffRole.create({
    key,
    name,
    description,
    permissions: cleanPermissions(permissions),
    system: false,
  });
  invalidate();
  return toPublicRole(role.toObject());
};

const updateRole = async (key, changes) => {
  const role = await StaffRole.findOne({ key });
  if (!role) throw ApiError.notFound('Role not found');
  if (key === SUPER_ADMIN) throw ApiError.badRequest('The Super Admin role always has full access and cannot be changed');

  const before = { name: role.name, description: role.description, permissions: [...role.permissions] };
  if (changes.name !== undefined) role.name = changes.name;
  if (changes.description !== undefined) role.description = changes.description;
  if (changes.permissions !== undefined) role.permissions = cleanPermissions(changes.permissions);
  await role.save();
  invalidate();

  const after = { name: role.name, description: role.description, permissions: [...role.permissions] };
  return { role: toPublicRole(role.toObject()), changes: { before, after } };
};

const deleteRole = async (key) => {
  const role = await StaffRole.findOne({ key });
  if (!role) throw ApiError.notFound('Role not found');
  if (role.system) throw ApiError.badRequest('Built-in roles cannot be deleted');

  const assigned = await User.countDocuments({ isStaff: true, deletedAt: null, adminLevel: key });
  if (assigned) {
    throw ApiError.conflict(`${assigned} staff account(s) still use this role. Move them to another role first.`);
  }

  await role.deleteOne();
  invalidate();
  return { key };
};

module.exports = {
  permissionsFor,
  roleExists,
  assertRoleExists,
  ensureDefaultRoles,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  invalidate,
  slugify,
  // Lets tests run without a database.
  __setCacheForTests: (roles) => {
    cache = new Map(roles.map((role) => [role.key, role]));
    cacheLoadedAt = Date.now();
  },
};
