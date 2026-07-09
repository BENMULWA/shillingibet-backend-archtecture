'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const smsClient = require('../integrations/sms/celcom.client');

const compactAmount = (amount) =>
  new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

const send = async ({ phone, message, context }) => {
  const result = await smsClient.sendSms({ phone, message });
  logger.info('SMS sent', context || 'general', phone);
  return result;
};

const safeSend = async ({ phone, message, context }) => {
  if (!config.sms.enabled) return { skipped: true, reason: 'disabled' };
  if (!smsClient.isConfigured()) {
    logger.warn('SMS skipped because gateway is not configured', context || 'general');
    return { skipped: true, reason: 'not_configured' };
  }

  try {
    await send({ phone, message, context });
    return { sent: true };
  } catch (err) {
    logger.error('SMS send failed', context || 'general', phone, err.message);
    return { sent: false, error: err.message };
  }
};

const sendPasswordResetCode = ({ phone, code }) =>
  send({
    phone,
    context: 'password_reset',
    message: `${config.sms.senderName}: your password reset code is ${code}. It expires in ${config.sms.resetCodeTtlMinutes} minutes.`,
  });

const sendPhoneVerificationCode = ({ phone, code }) =>
  send({
    phone,
    context: 'phone_verification',
    message: `${config.sms.senderName} your phone verification code is ${code}. It expires in ${config.sms.phoneVerificationTtlMinutes} minutes.`,
  });

const safeSendPhoneVerificationCode = ({ phone, code }) =>
  safeSend({
    phone,
    context: 'phone_verification',
    message: `${config.sms.senderName} your phone verification code is ${code}. It expires in ${config.sms.phoneVerificationTtlMinutes} minutes.`,
  });

const sendSignupWelcome = ({ phone, name }) => {
  const greeting = name ? `Hi ${name}, ` : 'Welcome, ';
  return safeSend({
    phone,
    context: 'signup_welcome',
    message: `${config.sms.senderName}: ${greeting}your ShilingiBet account has been created successfully.`,
  });
};

const sendTransactionStatus = ({ phone, type, amount, status, receipt, failureReason, currency = 'KES', walletType = 'balance' }) => {
  const action = type === 'deposit' ? 'deposit' : 'withdrawal';
  const amountText = compactAmount(amount);
  const currencyLabel = currency === 'ARTM' || walletType === 'airtime' ? 'ARTM' : 'KES';

  if (status === 'completed') {
    const receiptText = receipt ? ` Ref: ${receipt}.` : '';
    return safeSend({
      phone,
      context: `${action}_completed`,
      message: `${config.sms.senderName}: your ${action} of ${currencyLabel} ${amountText} was successful.${receiptText}`,
    });
  }

  return safeSend({
    phone,
    context: `${action}_failed`,
    message: `${config.sms.senderName}: your ${action} of ${currencyLabel} ${amountText} failed${failureReason ? `: ${failureReason}` : '.'}`,
  });
};

module.exports = {
  send,
  safeSend,
  sendPasswordResetCode,
  sendPhoneVerificationCode,
  safeSendPhoneVerificationCode,
  sendSignupWelcome,
  sendTransactionStatus,
};
