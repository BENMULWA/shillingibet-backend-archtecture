'use strict';

const config = require('../config');
const ApiError = require('../utils/ApiError');
const { verifyCallbackSignature } = require('../integrations/comet/comet.signature');

module.exports = (req, _res, next) => {
  const secret = config.comet.callbackSecret;
  if (!secret) {
    return next(new ApiError(503, 'Comet callback verification is not configured'));
  }

  const valid = verifyCallbackSignature({
    rawBody: req.body,
    timestamp: req.get('X-Comet-Timestamp'),
    signature: req.get('X-Comet-Signature'),
    secret,
  });

  if (!valid) return next(ApiError.unauthorized('Invalid or expired Comet callback signature'));
  return next();
};