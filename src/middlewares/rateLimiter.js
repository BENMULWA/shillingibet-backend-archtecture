'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

const PROVIDER_CALLBACKS = ['/virtuals/player_info', '/virtuals/bet', '/virtuals/win', '/virtuals/rollback'];

const isProviderCallback = (req) =>
  req.path.startsWith('/transactions/callback') ||
  req.path === '/wallet/billOrder/callback' ||
  PROVIDER_CALLBACKS.includes(req.path);

const perUserKey = (req, res) => (req.user ? `user:${req.user._id}` : ipKeyGenerator(req, res));

const makeUserLimiter = ({ windowMs, max, message, skipFailedRequests = false }) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: perUserKey,
    skipFailedRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isProviderCallback,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

const depositLimiter = makeUserLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many deposit attempts. Maximum 5 deposits per minute.',
});

const withdrawalLimiter = makeUserLimiter({
  windowMs: 3 * 60 * 1000,
  max: 1,
  skipFailedRequests: true,
  message: 'Only one withdrawal is allowed every 3 minutes.',
});

const launchLimiter = makeUserLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many game launches, please slow down.',
});

module.exports = {
  apiLimiter,
  authLimiter,
  depositLimiter,
  withdrawalLimiter,
  launchLimiter,
};
