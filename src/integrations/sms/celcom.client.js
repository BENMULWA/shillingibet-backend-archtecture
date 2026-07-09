'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');
const { toLocalPhone } = require('../../utils/phone');

const { sms } = config;

const isConfigured = () => Boolean(sms.partnerId && sms.apiKey && sms.shortcode);

const assertConfigured = () => {
  if (!sms.enabled) {
    throw new ApiError(503, 'SMS is disabled');
  }
  if (!isConfigured()) {
    throw new ApiError(500, 'SMS gateway is not configured');
  }
};

const sendSms = async ({ phone, message }) => {
  assertConfigured();

  const headers = { 'Content-Type': 'application/json' };
  if (sms.phpSessionId) {
    headers.Cookie = `PHPSESSID=${sms.phpSessionId}`;
  }

  const res = await fetch(`${sms.baseUrl}/api/services/sendsms/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      partnerID: sms.partnerId,
      apikey: sms.apiKey,
      mobile: toLocalPhone(phone),
      message,
      shortcode: sms.shortcode,
      pass_type: sms.passType,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error('Celcom SMS request failed', res.status, data);
    throw new ApiError(502, data.message || data.error || 'SMS gateway request failed');
  }

  const firstResponse = Array.isArray(data.responses) ? data.responses[0] || {} : {};
  const status = String(
    data.status ||
    data.responseCode ||
    data.code ||
    firstResponse['response-code'] ||
    firstResponse.responseCode ||
    ''
  ).toLowerCase();
  const responseDescription = String(
    data.response ||
    data.message ||
    firstResponse['response-description'] ||
    firstResponse.responseDescription ||
    ''
  );
  const success =
    data.success === true ||
    status === 'success' ||
    status === '200' ||
    status === 'ok' ||
    responseDescription.toLowerCase() === 'success';

  if (!success) {
    logger.error('Celcom SMS rejected request', data);
    throw new ApiError(
      502,
      data.message ||
        data.response ||
        firstResponse['response-description'] ||
        firstResponse.responseDescription ||
        'SMS gateway rejected the message'
    );
  }

  return data;
};

module.exports = { sendSms, isConfigured };
