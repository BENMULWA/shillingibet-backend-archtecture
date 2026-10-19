'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');
const { createRequestSignature } = require('./comet.signature');

const { baseUrl, apiKey, apiSecret, apiKeyHeader } = config.comet;

const createAuthHeaders = ({
  method = 'POST',
  path,
  rawBody = '',
  timestamp = Math.floor(Date.now() / 1000).toString(),
  key = apiKey,
  secret = apiSecret,
  keyHeader = apiKeyHeader,
}) => {
  if (!key || !secret) {
    throw new ApiError(503, 'Comet API key and secret are not configured');
  }

  return {
    [keyHeader]: key,
    'X-Timestamp': timestamp,
    'X-Signature': createRequestSignature({ method, path, timestamp, rawBody, secret }),
  };
};

const request = async (path, { method = 'POST', body } = {}) => {
  const url = new URL(`${baseUrl}${path}`);
  const rawBody = body === undefined ? '' : JSON.stringify(body);
  const requestMethod = method.toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    ...createAuthHeaders({
      method: requestMethod,
      path: `${url.pathname}${url.search}`,
      rawBody,
    }),
  };

  const res = await fetch(url, {
    method: requestMethod,
    headers,
    body: body === undefined ? undefined : rawBody,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.error || 'Comet request failed';
    logger.error('Comet request failed', path, res.status, data);
    throw new ApiError(502, message, data);
  }

  return data;
};

const createBillOrder = (payload) =>
  request('/bill-orders/external', { body: payload });

module.exports = { createBillOrder, createAuthHeaders };