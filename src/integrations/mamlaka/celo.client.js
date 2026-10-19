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
  const token = data.access_token;

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

// Every call below is scoped by externalUserId. The gateway derives and
// tracks a separate deposit address and balance per (this partner,
// externalUserId) — it must always be this platform's own internal user id
// (e.g. the Mongo _id), never omitted. Calling without it would credit/debit
// a shared platform-wide bucket instead of the individual bettor.
const getDepositInstructions = (externalUserId, asset = 'USDT') =>
  request('/api/celo/deposit/initiate', {
    method: 'POST',
    body: { external_user_id: String(externalUserId), asset },
  });

const getDepositStatus = (depositId) => request(`/api/celo/deposit/${encodeURIComponent(depositId)}/status`);

const getBalance = (externalUserId) =>
  request(`/api/celo/balance/${encodeURIComponent(String(externalUserId))}`);

// Live rate, margin-adjusted the same way the gateway credits deposits —
// use this instead of a locally hardcoded rate so a KES payout amount always
// matches what the gateway will actually settle.
const getQuote = ({ amount, from, to }) =>
  request(
    `/api/celo/quote?amount=${encodeURIComponent(amount)}&from_currency=${encodeURIComponent(from)}&to_currency=${encodeURIComponent(to)}`
  );

// The gateway now supports an idempotency key: a retried call with the same
// idempotencyKey AND the same externalUserId/asset/amount/toAddress replays
// the original result instead of broadcasting a second transaction. Always
// pass one — generate it once per withdrawal attempt on this side (e.g. the
// Transaction._id or externalId already created before calling this) and
// reuse the SAME value on any retry of that same logical withdrawal.
const withdraw = ({ externalUserId, asset = 'USDT', amount, toAddress, idempotencyKey }) =>
  request('/api/celo/withdraw', {
    method: 'POST',
    body: {
      external_user_id: String(externalUserId),
      asset,
      amount,
      destination_address: toAddress,
      idempotency_key: idempotencyKey,
    },
  });

module.exports = { getDepositInstructions, getDepositStatus, getBalance, getQuote, withdraw };
