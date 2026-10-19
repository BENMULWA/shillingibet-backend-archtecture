'use strict';

const crypto = require('crypto');

const verifyMamlakaSignature = (rawBody, header, secret) => {
  if (!Buffer.isBuffer(rawBody) || !secret) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;
  const actualBuffer = Buffer.from(header || '', 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

module.exports = { verifyMamlakaSignature };
