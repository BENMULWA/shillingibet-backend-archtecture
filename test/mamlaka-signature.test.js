'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyMamlakaSignature } = require('../src/integrations/mamlaka/mamlaka.signature');

test('verifies a Mamlaka SHA-256 callback signature against the raw bytes', () => {
  const body = Buffer.from('{"externalId":"DEP-123","amount":100}');
  const secret = 'callback-secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

  assert.equal(verifyMamlakaSignature(body, signature, secret), true);
  assert.equal(verifyMamlakaSignature(Buffer.from(`${body} `), signature, secret), false);
  assert.equal(verifyMamlakaSignature(body, 'sha256=invalid', secret), false);
  assert.equal(verifyMamlakaSignature(body, signature, ''), false);
});
