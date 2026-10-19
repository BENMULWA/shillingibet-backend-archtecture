'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../src/config');
const cometClientPath = require.resolve('../src/integrations/comet/comet.client');
const { createAuthHeaders } = require(cometClientPath);
const {
  createRequestSignature,
  verifyCallbackSignature,
} = require('../src/integrations/comet/comet.signature');

test('Comet request signature uses method, full path, timestamp, and raw body', () => {
  const method = 'POST';
  const path = '/api/v1/bill-orders/external';
  const timestamp = '1700000000';
  const rawBody = '{"direction":"debit","amount":100,"currency":"KES"}';
  const secret = 'test-secret';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${method}\n${path}\n${timestamp}\n${rawBody}`)
    .digest('hex');

  assert.equal(createRequestSignature({ method, path, timestamp, rawBody, secret }), expected);
});

test('Comet auth headers include API key, timestamp, and canonical signature', () => {
  const method = 'POST';
  const path = '/api/v1/bill-orders/external';
  const timestamp = '1700000000';
  const rawBody = '{"amount":100,"currency":"KES"}';
  const secret = 'test-secret';
  const headers = createAuthHeaders({
    method,
    path,
    rawBody,
    timestamp,
    key: 'test-key',
    secret,
  });

  assert.deepEqual(headers, {
    'x-api-key': 'test-key',
    'X-Timestamp': timestamp,
    'X-Signature': createRequestSignature({ method, path, timestamp, rawBody, secret }),
  });
});

test('Comet auth header generation refuses missing credentials', () => {
  assert.throws(
    () => createAuthHeaders({ payload: {}, key: '', secret: '' }),
    /Comet API key and secret are not configured/
  );
});

test('Comet callback signature is verified and rejects stale or altered callbacks', () => {
  const timestamp = '1700000000';
  const rawBody = Buffer.from('{"event":"bill_order.approved","status":"approved"}');
  const secret = 'callback-secret';
  const now = Number(timestamp) * 1000;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  const signature = `sha256=${digest}`;

  assert.equal(verifyCallbackSignature({ rawBody, timestamp, signature, secret, now }), true);
  assert.equal(verifyCallbackSignature({ rawBody, timestamp, signature, secret, now: now + 301_000 }), false);
  assert.equal(
    verifyCallbackSignature({ rawBody: Buffer.from(`${rawBody} `), timestamp, signature, secret, now }),
    false
  );
});

test('Comet HTTP client signs the exact serialized body and full API path', async () => {
  const originalConfig = {
    baseUrl: config.comet.baseUrl,
    apiKey: config.comet.apiKey,
    apiSecret: config.comet.apiSecret,
    apiKeyHeader: config.comet.apiKeyHeader,
  };
  const originalFetch = global.fetch;
  const originalModule = require.cache[cometClientPath];
  let capturedRequest;

  config.comet.baseUrl = 'https://comet.example/api/v1';
  config.comet.apiKey = 'client-key';
  config.comet.apiSecret = 'client-secret';
  config.comet.apiKeyHeader = 'X-API-Key';
  delete require.cache[cometClientPath];
  const { createBillOrder } = require(cometClientPath);
  global.fetch = async (url, options) => {
    capturedRequest = { url: String(url), ...options };
    return { ok: true, json: async () => ({ status: 'success' }) };
  };

  try {
    const payload = { direction: 'debit', email: 'player@example.com', amount: 50, currency: 'KES' };
    await createBillOrder(payload);

    const url = new URL(capturedRequest.url);
    const timestamp = capturedRequest.headers['X-Timestamp'];
    const expected = createRequestSignature({
      method: 'POST',
      path: `${url.pathname}${url.search}`,
      timestamp,
      rawBody: capturedRequest.body,
      secret: 'client-secret',
    });

    assert.equal(url.pathname, '/api/v1/bill-orders/external');
    assert.equal(capturedRequest.headers['X-API-Key'], 'client-key');
    assert.equal(capturedRequest.headers['X-Signature'], expected);
    assert.deepEqual(JSON.parse(capturedRequest.body), payload);
  } finally {
    global.fetch = originalFetch;
    Object.assign(config.comet, originalConfig);
    require.cache[cometClientPath] = originalModule;
  }
});