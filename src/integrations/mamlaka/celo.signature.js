'use strict';

const crypto = require('crypto');

// Matches webhooks.py::_sign on the gateway side: raw hex HMAC-SHA256 of the
// exact request body, no "sha256=" prefix (unlike the other Mamlaka
// integration's verifyMamlakaSignature, which does use that prefix).
const verifyCeloGatewaySignature = (rawBody, header, secret) => {
  if (!Buffer.isBuffer(rawBody) || !secret || !header) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(header, 'utf8');

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

module.exports = { verifyCeloGatewaySignature };
