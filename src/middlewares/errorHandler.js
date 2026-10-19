'use strict';

const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const config = require('../config');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, _next) => {
  let error = err;

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((e) => ({ field: e.path, message: e.message }));
    error = ApiError.badRequest('Validation failed', details);
  } else if (error instanceof mongoose.Error.CastError) {
    error = ApiError.badRequest(`Invalid ${error.path}: ${error.value}`);
  } else if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0];
    error = ApiError.conflict(`Duplicate value for "${field}"`);
  } else if (error.name === 'JsonWebTokenError') {
    error = ApiError.unauthorized('Invalid token');
  } else if (error.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Token expired');
  } else if (!(error instanceof ApiError)) {
    logger.error('Unhandled error', err);
    error = new ApiError(500, 'Internal server error');
  }

  const body = {
    success: false,
    message: error.message,
  };
  if (error.details) body.details = error.details;
  if (!config.isProd && error.statusCode === 500) body.stack = err.stack;

  res.status(error.statusCode || 500).json(body);
};
