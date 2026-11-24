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
    displayName: process.env.MAMLAKA_DISPLAY_NAME || 'Bingwake',
    currency: process.env.MAMLAKA_CURRENCY || 'KES',
    defaultProvider: process.env.MAMLAKA_DEFAULT_PROVIDER || 'M-Pesa',
    callbackBaseUrl: (
      process.env.MAMLAKA_CALLBACK_BASE_URL ||
      process.env.PUBLIC_CALLBACK_BASE_URL ||
      `http://localhost:${process.env.PORT || 5050}`
    ).replace(/\/$/, ''),
    callbackSecret: process.env.MAMLAKA_CALLBACK_SECRET || '',
    // Mamlaka's callback servers. Empty = accept callbacks from any address (signature still checked).
    callbackIps: (process.env.MAMLAKA_CALLBACK_IPS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  },

  mamlakaCelo: {
    baseUrl: (process.env.MAMLAKA_CELO_BASE_URL || 'https://celo.mamlakapsp.com').replace(/\/$/, ''),
    apiKey: process.env.MAMLAKA_CELO_API_KEY || '',
    secretKey: process.env.MAMLAKA_CELO_SECRET_KEY || '',
    webhookSecret: process.env.MAMLAKA_CELO_WEBHOOK_SECRET || '',
  },

  comet: {
    clientId: process.env.COMET_CLIENT_ID || 'shillingi_bet',
    baseUrl: (process.env.COMET_BASE_URL || 'https://cometapi.mamlakapsp.com/api/v1').replace(/\/$/, ''),
    apiKey: process.env.COMET_API_KEY || '',
    apiSecret: process.env.COMET_API_SECRET || '',
    apiKeyHeader: process.env.COMET_API_KEY_HEADER || 'x-api-key',
    currency: process.env.COMET_CURRENCY || 'KES',
    callbackBaseUrl: (
      process.env.COMET_CALLBACK_BASE_URL ||
      process.env.PUBLIC_CALLBACK_BASE_URL ||
      `http://localhost:${process.env.PORT || 5050}`
    ).replace(/\/$/, ''),
    callbackSecret: process.env.COMET_CALLBACK_SECRET || '',
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

  // Charges on cash withdrawals: WITHDRAWAL_TAX_RATE is a fraction (0.05 = 5%) taken on every
  // withdrawal; WITHDRAWAL_FEE is a flat KES amount taken only when the withdrawal is at least
  // WITHDRAWAL_FEE_MIN_AMOUNT. Both are kept by the platform; the player receives the rest.
  withdrawal: {
    taxRate: Math.min(Math.max(Number(process.env.WITHDRAWAL_TAX_RATE ?? 0.05) || 0, 0), 0.5),
    fee: Math.max(Number(process.env.WITHDRAWAL_FEE ?? 0) || 0, 0),
    feeMinAmount: Math.max(Number(process.env.WITHDRAWAL_FEE_MIN_AMOUNT ?? 150) || 0, 0),
  },

  // Every withdrawal first checks the wallet is explained by deposits, play and recorded
  // credits; an hourly scan flags any wallet that is not (see balanceIntegrity.service.js).
  balanceIntegrity: {
    enforceOnWithdrawal: process.env.BALANCE_INTEGRITY_ENFORCE !== 'false',
    // A player must have at least one real completed deposit before any withdrawal.
    requireDepositBeforeWithdrawal: process.env.REQUIRE_DEPOSIT_BEFORE_WITHDRAWAL !== 'false',
    toleranceKes: Math.max(Number(process.env.BALANCE_INTEGRITY_TOLERANCE_KES) || 1, 0),
    scanEnabled:
      process.env.BALANCE_INTEGRITY_SCAN_ENABLED != null
        ? process.env.BALANCE_INTEGRITY_SCAN_ENABLED === 'true'
        : (process.env.NODE_ENV || 'development') === 'production',
    scanMinutes: Math.max(Number(process.env.BALANCE_INTEGRITY_SCAN_MINUTES) || 60, 5),
    // Who gets an SMS when an account is flagged. Defaults to the liquidity alert numbers.
    alertPhones: (process.env.FRAUD_ALERT_PHONES || process.env.LIQUIDITY_ALERT_PHONES || '0714073826')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean),
  },

  // Hourly record of Mamlaka pay-in and payout balances for daily reconciliation.
  // Local development shares the live account, so only production records by default.
  providerSnapshots: {
    enabled:
      process.env.PROVIDER_SNAPSHOTS_ENABLED != null
        ? process.env.PROVIDER_SNAPSHOTS_ENABLED === 'true'
        : (process.env.NODE_ENV || 'development') === 'production',
    everyMinutes: Math.max(Number(process.env.PROVIDER_SNAPSHOT_MINUTES) || 60, 5),
  },

  // Gateway watchdog: reads the Mamlaka balances every minute and alerts when money leaves
  // that Bingwake did not send (see gatewayWatch.service.js).
  gatewayWatch: {
    enabled:
      process.env.GATEWAY_WATCH_ENABLED != null
        ? process.env.GATEWAY_WATCH_ENABLED === 'true'
        : (process.env.NODE_ENV || 'development') === 'production',
    everySeconds: Math.max(Number(process.env.GATEWAY_WATCH_SECONDS) || 60, 30),
    // Alert when this much leaves unexplained within the short window (KES)...
    thresholdKes: Math.max(Number(process.env.GATEWAY_WATCH_THRESHOLD_KES) || 100, 1),
    // ...or this much within the hour (catches slow, small drains).
    hourThresholdKes: Math.max(Number(process.env.GATEWAY_WATCH_HOUR_THRESHOLD_KES) || 300, 1),
    windowMinutes: Math.max(Number(process.env.GATEWAY_WATCH_WINDOW_MINUTES) || 10, 2),
    // Allowance for provider charges on our own transactions, so they don't look like theft.
    feePerTxnKes: Math.max(Number(process.env.GATEWAY_WATCH_FEE_PER_TXN_KES) || 35, 0),
    feeRate: Math.max(Number(process.env.GATEWAY_WATCH_FEE_RATE) || 0.03, 0),
    // Pause M-Pesa withdrawals automatically when an alert fires, until a super admin reviews it.
    autoHold: process.env.GATEWAY_WATCH_AUTO_HOLD !== 'false',
    alertPhones: (process.env.GATEWAY_ALERT_PHONES || process.env.FRAUD_ALERT_PHONES || process.env.LIQUIDITY_ALERT_PHONES || '0714073826')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean),
    unknownCallbackSmsCooldownMinutes: Math.max(Number(process.env.GATEWAY_UNKNOWN_CALLBACK_SMS_COOLDOWN_MINUTES) || 30, 1),
  },

  // Alerts for the real money at the payment provider (Mamlaka payout balance).
  liquidity: {
    alertPhones: (process.env.LIQUIDITY_ALERT_PHONES || '0714073826')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean),
    threshold: Number(process.env.LIQUIDITY_ALERT_THRESHOLD) || 500,
    checkMinutes: Number(process.env.LIQUIDITY_CHECK_MINUTES) || 5,
    cooldownMinutes: Number(process.env.LIQUIDITY_ALERT_COOLDOWN_MINUTES) || 60,
    // Local development shares the live account, so only production watches by default.
    monitorEnabled:
      process.env.LIQUIDITY_MONITOR_ENABLED != null
        ? process.env.LIQUIDITY_MONITOR_ENABLED === 'true'
        : (process.env.NODE_ENV || 'development') === 'production',
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
    staffLoginCodeTtlMinutes: parseInt(process.env.STAFF_LOGIN_CODE_TTL_MINUTES, 10) || 10,
  },
});

module.exports = config;
