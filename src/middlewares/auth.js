'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../domains/user/user.model');
const staffRoles = require('../domains/admin/staffRole.service');

// Original built-in levels. Staff roles now live in the StaffRole collection;
// this list is kept for older callers.
const STAFF_LEVELS = ['support', 'admin', 'super_admin'];

const getStaffLevel = (user) => {
  if (!user) return null;
  if (user.adminLevel) return user.adminLevel;
  if (user.role === 'admin') return 'super_admin';
  return null;
};

const isStaffUser = (user) => Boolean(user?.isStaff || getStaffLevel(user));

const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Authentication token missing');

  const payload = jwt.verify(token, config.jwt.secret);
  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (user.deletedAt) throw ApiError.unauthorized('User no longer exists');
  if (user.status !== 'active') throw ApiError.forbidden('Account is suspended');
  if (user.phoneVerified !== true) {
    throw ApiError.forbidden('Phone number not verified');
  }

  req.user = user;
  req.authClaims = payload;
  next();
});

const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(ApiError.forbidden('Insufficient permissions'));
  }
  next();
};

// Shared checks for every staff-only route: a staff account with a role, signed in
// through the SMS-verified staff flow. Returns the error to send, or null.
const staffDenial = (req) => {
  if (!req.user || !isStaffUser(req.user)) return ApiError.forbidden('Staff access required');
  if (!getStaffLevel(req.user)) return ApiError.forbidden('Insufficient permissions');
  // Staff privileges need a token issued after the SMS code check, never a plain login token.
  if (req.authClaims?.mfa !== true) return ApiError.forbidden('Staff sign-in verification required');
  return null;
};

// Restricts a route to specific roles. With no arguments any staff role passes.
// Prefer requirePermission for anything the role editor should control.
const authorizeStaff = (...levels) => (req, _res, next) => {
  const denial = staffDenial(req);
  if (denial) return next(denial);
  if (levels.length && !levels.includes(getStaffLevel(req.user))) {
    return next(ApiError.forbidden('Insufficient permissions'));
  }
  next();
};

// Passes when the staff member's role holds at least one of the given permissions.
const requirePermission = (...permissions) => async (req, _res, next) => {
  const denial = staffDenial(req);
  if (denial) return next(denial);
  try {
    const granted = await staffRoles.permissionsFor(getStaffLevel(req.user));
    req.staffPermissions = granted;
    if (!permissions.some((permission) => granted.includes(permission))) {
      return next(ApiError.forbidden('Insufficient permissions'));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

// Staff accounts and roles stay with super admins: whoever could grant roles
// could hand themselves every other permission.
const requireSuperAdmin = authorizeStaff('super_admin');

module.exports = {
  authenticate,
  authorize,
  authorizeStaff,
  requirePermission,
  requireSuperAdmin,
  getStaffLevel,
  isStaffUser,
  STAFF_LEVELS,
};
