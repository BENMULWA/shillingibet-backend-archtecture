'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');

const { baseUrl, apiKey, apiKeyHeader } = config.fusion;

const request = async (path, { method = 'POST', body } = {}) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) headers[apiKeyHeader] = apiKey;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.error || 'Fusion request failed';
    logger.error('Fusion request failed', path, res.status, data);
    throw new ApiError(502, message, data);
  }

  return data;
};

const createBillOrder = (payload) =>
  request('/bill-orders/external', { body: payload });

module.exports = { createBillOrder };
