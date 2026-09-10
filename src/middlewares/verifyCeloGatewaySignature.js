'use strict';

const config = require('../config');
const ApiError = require('../utils/ApiError');
const { verifyCeloGatewaySignature } = require('../integrations/mamlaka/celo.signature');

module.exports = (req, _res, next) => {
  if (!config.mamlakaCelo.webhookSecret) {
    return next(new ApiError(503, 'Celo gateway webhook verification is not configured'));
  }

  const valid = verifyCeloGatewaySignature(
    req.body,
    req.get('X-Celo-Gateway-Signature'),
    config.mamlakaCelo.webhookSecret
  );

  if (!valid) return next(ApiError.unauthorized('Invalid Celo gateway webhook signature'));
  return next();
};
