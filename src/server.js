'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase } = require('./config/database');

let server;

async function start() {
  await connectDatabase();

  server = http.createServer(app);
  server.listen(config.port, () => {
    logger.info(`Betnare API listening on port ${config.port} [${config.env}]`);
    logger.info(`Base URL: http://localhost:${config.port}${config.apiPrefix}`);
  });
}

async function shutdown(signal) {
  logger.warn(`${signal} received — shutting down`);
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
  shutdown('unhandledRejection');
});

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
