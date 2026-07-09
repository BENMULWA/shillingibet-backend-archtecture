'use strict';

const cors = require('cors');
const config = require('../config');

const { credentials } = config.cors;

const corsOptions = {
  origin: true,
  credentials,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

module.exports = cors(corsOptions);
