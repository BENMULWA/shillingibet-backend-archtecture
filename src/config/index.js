'use strict';

require('dotenv').config();

const required = ['MONGO_URI', 'JWT_SECRET'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const parseOrigins = (value) => {
  if (!value || value.trim() === '*') return '*';
  return value
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
};

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  publicWebBaseUrl: (process.env.PUBLIC_WEB_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),

  mongo: {
    uri: process.env.MONGO_URI,
  },

  cors: {
    origins: parseOrigins(process.env.CORS_ORIGINS),
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,
  },

  mamlaka: {
    baseUrl: process.env.MAMLAKA_BASE_URL || 'https://payments.mam-laka.com',
    username: process.env.MAMLAKA_API_USERNAME,
    password: process.env.MAMLAKA_API_PASSWORD,
    merchantId: process.env.MAMLAKA_MERCHANT_ID,
    displayName: process.env.MAMLAKA_DISPLAY_NAME || 'ShilingiBet',
    currency: process.env.MAMLAKA_CURRENCY || 'KES',
    defaultProvider: process.env.MAMLAKA_DEFAULT_PROVIDER || 'M-Pesa',
    callbackBaseUrl: (
      process.env.MAMLAKA_CALLBACK_BASE_URL ||
      process.env.PUBLIC_CALLBACK_BASE_URL ||
      `http://localhost:${process.env.PORT || 5050}`
    ).replace(/\/$/, ''),
    callbackSecret: process.env.MAMLAKA_CALLBACK_SECRET || '',
  },

  fusion: {
    baseUrl: (process.env.FUSION_BASE_URL || 'https://sandbox.fusionfi.io/api/v1').replace(/\/$/, ''),
    apiKey: process.env.FUSION_API_KEY || '',
    apiKeyHeader: process.env.FUSION_API_KEY_HEADER || 'x-api-key',
    currency: process.env.FUSION_CURRENCY || 'KES',
    callbackBaseUrl: (process.env.FUSION_CALLBACK_BASE_URL || process.env.PUBLIC_CALLBACK_BASE_URL || `http://localhost:${process.env.PORT || 5050}`).replace(/\/$/, ''),
    callbackSecret: process.env.FUSION_CALLBACK_SECRET || '',
    orderExpiryMinutes: parseInt(process.env.FUSION_ORDER_EXPIRY_MINUTES, 10) || 1,
  },

  transactpay: {
    baseUrl: (process.env.TRANSACTPAY_BASE_URL || 'https://payment-api-service.transactpay.ai').replace(/\/$/, ''),
    apiKey: process.env.TRANSACTPAY_API_KEY || '',
    encryptionKey: process.env.TRANSACTPAY_ENCRYPTION_KEY || '',
    defaultCountry: process.env.TRANSACTPAY_DEFAULT_COUNTRY || 'US',
    currency: process.env.TRANSACTPAY_CURRENCY || 'USD',
    redirectUrl: process.env.TRANSACTPAY_REDIRECT_URL || process.env.PUBLIC_WEB_BASE_URL || 'http://localhost:5173',
  },

  limits: {
    deposit: {
      min: parseInt(process.env.DEPOSIT_MIN, 10) || 1,
      max: parseInt(process.env.DEPOSIT_MAX, 10) || 250000,
    },
    withdrawal: {
      min: parseInt(process.env.WITHDRAWAL_MIN, 10) || 10,
      max: parseInt(process.env.WITHDRAWAL_MAX, 10) || 250000,
    },
  },

  referral: {
    qualifyingDepositAmount: parseFloat(process.env.REFERRAL_QUALIFYING_DEPOSIT_AMOUNT) || 100,
    bonusAmount: parseFloat(process.env.REFERRAL_BONUS_AMOUNT) || 20,
  },

  eurovirtuals: {
    baseUrl: (process.env.EUROVIRTUALS_BASE_URL || 'https://api.staging.betkraft.co.uk').replace(/\/$/, ''),
    apiKey: process.env.EUROVIRTUALS_API_KEY,
    appKey: process.env.EUROVIRTUALS_APP_KEY,
    currency: process.env.EUROVIRTUALS_CURRENCY || 'KES',
    returnUrl: (process.env.EUROVIRTUALS_RETURN_URL || process.env.PUBLIC_WEB_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
    verifyCallbacks: process.env.EUROVIRTUALS_VERIFY_CALLBACKS !== 'false',
    sessionTtlHours: parseInt(process.env.EUROVIRTUALS_SESSION_TTL_HOURS, 10) || 24,
  },

  sms: {
    enabled: process.env.SMS_ENABLED !== 'false',
    baseUrl: (process.env.SMS_BASE_URL || 'https://isms.celcomafrica.com').replace(/\/$/, ''),
    partnerId: process.env.SMS_PARTNER_ID || '',
    apiKey: process.env.SMS_API_KEY || '',
    shortcode: process.env.SMS_SHORTCODE || 'IMPALA LTD',
    passType: process.env.SMS_PASS_TYPE || 'plain',
    phpSessionId: process.env.SMS_PHPSESSID || '',
    senderName: process.env.SMS_SENDER_NAME || process.env.SMS_SHORTCODE || 'IMPALA LTD',
    resetCodeTtlMinutes: parseInt(process.env.SMS_RESET_CODE_TTL_MINUTES, 10) || 10,
    phoneVerificationTtlMinutes: parseInt(process.env.SMS_PHONE_VERIFICATION_TTL_MINUTES, 10) || 10,
  },
});

module.exports = config;
