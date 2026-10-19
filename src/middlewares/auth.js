'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../domains/user/user.model');

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
  if (user.phoneVerified !== true) {
    throw ApiError.forbidden('Phone number not verified');
  }

  req.user = user;
  next();
});

const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(ApiError.forbidden('Insufficient permissions'));
  }
  next();
};

const authorizeStaff = (...levels) => (req, _res, next) => {
  if (!req.user || !isStaffUser(req.user)) {
    return next(ApiError.forbidden('Staff access required'));
  }

  const requiredLevels = levels.length ? levels : STAFF_LEVELS;
  const staffLevel = getStaffLevel(req.user);
  if (!staffLevel || !requiredLevels.includes(staffLevel)) {
    return next(ApiError.forbidden('Insufficient permissions'));
  }

  next();
};

module.exports = { authenticate, authorize, authorizeStaff, getStaffLevel, isStaffUser, STAFF_LEVELS };
