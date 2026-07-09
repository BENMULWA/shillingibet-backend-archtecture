'use strict';

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const bodyParser = require('body-parser');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

const config = require('./config');
const corsMiddleware = require('./middlewares/cors');
const { apiLimiter } = require('./middlewares/rateLimiter');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const routes = require('./routes');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());
app.use(corsMiddleware);
app.use(compression());

app.use(bodyParser.json({ limit: '10kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));

app.use(mongoSanitize());
app.use(hpp());

app.use(morgan(config.isProd ? 'combined' : 'dev'));

app.get('/', (_req, res) => {
  res.redirect(302, config.publicWebBaseUrl);
});

app.use(config.apiPrefix, apiLimiter, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
