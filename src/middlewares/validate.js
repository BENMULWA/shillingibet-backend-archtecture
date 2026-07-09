'use strict';

const ApiError = require('../utils/ApiError');

const validate = (schemas) => (req, _res, next) => {
  try {
    for (const key of ['body', 'query', 'params']) {
      if (schemas[key]) {
        req[key] = schemas[key].parse(req[key]);
      }
    }
    next();
  } catch (err) {
    const details = (err.errors || []).map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    next(ApiError.badRequest('Validation failed', details));
  }
};

module.exports = validate;
