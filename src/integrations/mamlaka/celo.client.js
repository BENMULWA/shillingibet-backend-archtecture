'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');

const { baseUrl, apiKey, secretKey } = config.mamlakaCelo;

let cachedToken = null;
let tokenExpiresAt = 0;

const decodeExpiry = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
};

const parseResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.msg).filter(Boolean).join(', ')
      : data.detail;
    logger.error('Mamlaka Celo request failed', response.status, data);
    throw new ApiError(502, detail || data.message || data.error || 'Celo provider request failed');
  }
  return data;
};

const authenticate = async () => {
  if (!apiKey || !secretKey) {
    throw new ApiError(503, 'Mamlaka Celo credentials are not configured');
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) return cachedToken;

  const response = await fetch(`${baseUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
  });
  const data = await parseResponse(response);
  const token =
    data.access_token ||
    data.accessToken ||
    data.token ||
    data.data?.access_token ||
    data.data?.accessToken ||
    data.data?.token;

  if (!token) {
    throw new ApiError(502, 'Mamlaka Celo authentication returned no token');
  }

  cachedToken = token;
  tokenExpiresAt = decodeExpiry(token) || Date.now() + 10 * 60 * 1000;
  return token;
};

const request = async (path, options = {}, retry = true) => {
  const token = await authenticate();
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && retry) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return request(path, options, false);
  }

  return parseResponse(response);
};

const getDepositInstructions = () => request('/v1/deposit');
const getBalance = () => request('/v1/balance');
const withdraw = ({ toAddress, amount, idempotencyKey }) =>
  request('/v1/withdraw', {
    method: 'POST',
    body: {
      to_address: toAddress,
      amount,
      idempotency_key: idempotencyKey,
    },
  });

module.exports = { getDepositInstructions, getBalance, withdraw };
