'use strict';

const { Router } = require('express');
const ApiError = require('../../utils/ApiError');
const config = require('../../config');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { depositLimiter } = require('../../middlewares/rateLimiter');
const controller = require('./wallet.controller');
const schemas = require('./wallet.validation');

const router = Router();

const verifyCallbackSecret = (req, _res, next) => {
  const expected = config.fusion.callbackSecret;
  if (!expected) return next();
  if (req.query.secret === expected) return next();
  return next(ApiError.unauthorized('Invalid callback secret'));
};

router.post(
  '/billOrder/callback',
  verifyCallbackSecret,
  validate({ body: schemas.callback }),
  controller.callback,
);

router.use(authenticate);

router.post(
  '/billOrder',
  depositLimiter,
  validate({ body: schemas.billOrder }),
  controller.billOrder,
);

router.post(
  '/card-link',
  depositLimiter,
  validate({ body: schemas.cardLink }),
  controller.cardLink,
);

module.exports = router;
