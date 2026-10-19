'use strict';

const crypto = require('crypto');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');

const { apiKey, baseUrl, encryptionKey } = config.transactpay;

const toBase64Url = (buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const parsePublicKey = (encodedKey) => {
  const decodedKey = Buffer.from(encodedKey, 'base64').toString('utf8');
  const xmlData = decodedKey.startsWith('4096!')
    ? decodedKey.slice('4096!'.length)
    : decodedKey;

  const modulusMatch = xmlData.match(/<Modulus>([^<]+)<\/Modulus>/);
  const exponentMatch = xmlData.match(/<Exponent>([^<]+)<\/Exponent>/);
  if (!modulusMatch || !exponentMatch) {
    throw new Error('Unable to parse TransactPay RSA key');
  }

  return crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: toBase64Url(Buffer.from(modulusMatch[1], 'base64')),
      e: toBase64Url(Buffer.from(exponentMatch[1], 'base64')),
    },
    format: 'jwk',
  });
};

const encryptPayload = (payload) => {
  if (!encryptionKey) {
    throw ApiError.badRequest('TransactPay encryption key is not configured');
  }

  const publicKey = parsePublicKey(encryptionKey);
  const rawPayload = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    rawPayload
  );

  return encrypted.toString('base64');
};

const request = async (path, payload) => {
  if (!apiKey) {
    throw ApiError.badRequest('TransactPay API key is not configured');
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({ data: encryptPayload(payload) }),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    logger.error('TransactPay request failed', path, res.status, data);
    throw new ApiError(502, data.message || 'TransactPay request failed', data);
  }

  return data;
};

const createPaymentLink = (payload) => request('/payment/create', payload);

module.exports = {
  createPaymentLink,
};
