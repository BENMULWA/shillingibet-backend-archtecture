'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const service = require('../src/domains/wallet/wallet.service');
const { cometWebhook } = require('../src/domains/wallet/wallet.controller');

test('declined Comet callback validates signed body without client header', async () => {
  const originalHandleCallback = service.handleCallback;
  const payload = {
    amount: 10,
    client_id: config.comet.clientId,
    direction: 'debit',
    event: 'bill_order.declined',
    order_id: 19,
    payer_email: 'player@example.com',
    status: 'declined',
    user_id: 167,
  };
  let handledPayload;
  let responseStatus;
  let responseBody;
  let callbackError;

  service.handleCallback = async (callbackPayload) => {
    handledPayload = callbackPayload;
    return { status: 'declined' };
  };

  try {
    await cometWebhook(
      {
        body: Buffer.from(JSON.stringify(payload)),
        get: (header) => (header === 'X-Comet-Event' ? payload.event : undefined),
      },
      {
        status(status) {
          responseStatus = status;
          return this;
        },
        json(body) {
          responseBody = body;
          return this;
        },
      },
      (error) => {
        callbackError = error;
      }
    );
  } finally {
    service.handleCallback = originalHandleCallback;
  }

  assert.equal(callbackError, undefined);
  assert.deepEqual(handledPayload, payload);
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.success, true);
});