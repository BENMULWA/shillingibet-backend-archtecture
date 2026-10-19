'use strict';

const crypto = require('crypto');

const createRequestSignature = ({ method, path, timestamp, rawBody, secret }) =>
  crypto
    .createHmac('sha256', secret)
    .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${rawBody}`)
    .digest('hex');

const verifyCallbackSignature = ({ rawBody, timestamp, signature, secret, now = Date.now() }) => {
  if (!Buffer.isBuffer(rawBody) || !timestamp || !signature || !secret) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || Math.abs(Math.floor(now / 1000) - timestampSeconds) > 300) {
    return false;
  }

  const match = /^sha256=([a-f\d]{64})$/i.exec(signature);
  if (!match) return false;

  const expected = Buffer.from(
    crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex'),
    'hex'
  );
  const actual = Buffer.from(match[1], 'hex');

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

module.exports = { createRequestSignature, verifyCallbackSignature };