'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');

const { baseUrl, username, password } = config.mamlaka;

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

const fetchToken = async () => {
  if (!username || !password) {
    throw new ApiError(500, 'Mamlaka credentials are not configured');
  }

  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  const res = await fetch(`${baseUrl}/api/v1/`, {
    method: 'GET',
    headers: { Authorization: `Basic ${basic}` },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error('Mamlaka auth failed', res.status, body);
    throw new ApiError(502, 'Payment provider authentication failed');
  }

  const token = body.token || body.accessToken || body.access_token || body.jwt;
  if (!token) {
    logger.error('Mamlaka auth response missing token', body);
    throw new ApiError(502, 'Payment provider returned no token');
  }

  cachedToken = token;
  const exp = decodeExpiry(token);
  tokenExpiresAt = exp || Date.now() + 10 * 60 * 1000;
  return token;
};

const getToken = async () => {
  const skew = 30 * 1000;
  if (cachedToken && Date.now() < tokenExpiresAt - skew) return cachedToken;
  return fetchToken();
};

const request = async (path, { method = 'POST', body } = {}, retry = true) => {
  const token = await getToken();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    cachedToken = null;
    return request(path, { method, body }, false);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.error || 'Payment provider request failed';
    logger.error('Mamlaka request failed', path, res.status, data);
    throw new ApiError(502, message, data.error ? { code: data.error } : undefined);
  }

  return data;
};

const initiateCollection = (payload) =>
  request('/api/v1/mobile/initiate', { body: payload });

const initiateTransfer = (payload) =>
  request('/api/v1/mobile/transfer', { body: payload });

const initiateAirtime = (payload) =>
  request('/api/v1/mobile/airtime', { body: payload });

const getPayoutBalance = () =>
  request('/api/v1/read/payouts/balance', { method: 'GET' });

const getPayinBalance = () =>
  request('/api/v1/read/payins/balance', { method: 'GET' });

const normalizeTransactionStatusResponse = (data) => {
  const txn = data?.transaction && typeof data.transaction === 'object' ? data.transaction : data;
  return {
    amount: txn.amount != null ? Number(txn.amount) : undefined,
    currency: txn.currency,
    externalId: txn.externalId || txn.external_id,
    secureId: txn.secureId || txn.secure_id,
    transactionId: txn.transactionId || txn.transaction_id,
    transactionReceipt: txn.transactionReceipt || txn.transaction_receipt || txn.reference,
    transactionReport: txn.transactionReport || txn.transaction_report,
    transactionStatus: txn.transactionStatus || txn.transaction_status || txn.status,
    raw: data,
  };
};

const getTransactionStatus = async (transactionId) => {
  const merchant = config.mamlaka.merchantId || username;
  const data = await request(
    `/api/v1/transaction?merchant=${encodeURIComponent(merchant)}&secureId=${encodeURIComponent(transactionId)}`,
    { method: 'GET' }
  );
  return normalizeTransactionStatusResponse(data);
};

module.exports = {
  initiateCollection,
  initiateTransfer,
  initiateAirtime,
  getPayoutBalance,
  getPayinBalance,
  getTransactionStatus,
  normalizeTransactionStatusResponse,
};
