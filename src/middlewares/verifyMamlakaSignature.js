'use strict';

const config = require('../config');
const ApiError = require('../utils/ApiError');
const { verifyMamlakaSignature } = require('../integrations/mamlaka/mamlaka.signature');

module.exports = (req, _res, next) => {
  if (!config.mamlaka.callbackSecret) {
    return next(new ApiError(503, 'Mamlaka callback verification is not configured'));
  }

  const valid = verifyMamlakaSignature(
    req.body,
    req.get('X-Mamlaka-Signature'),
    config.mamlaka.callbackSecret
  );

  if (!valid) return next(ApiError.unauthorized('Invalid Mamlaka signature'));
  return next();
};
