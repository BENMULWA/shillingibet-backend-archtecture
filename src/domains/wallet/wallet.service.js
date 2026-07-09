'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/ApiError');
const config = require('../../config');
const logger = require('../../utils/logger');
const {
  withTransaction,
  incWalletBalance,
  normalizeWalletType,
} = require('../../utils/db');
const fusion = require('../../integrations/fusion/fusion.client');
const transactpay = require('../../integrations/transactpay/transactpay.client');
const Transaction = require('../transaction/transaction.model');
const User = require('../user/user.model');

const makeRef = () => `FUS-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const makeCardRef = () => `CARD-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

const getFusionOrder = (providerResponse) =>
  providerResponse?.order && typeof providerResponse.order === 'object'
    ? providerResponse.order
    : null;

const getExpiryCutoff = (now = new Date()) =>
  new Date(now.getTime() - config.fusion.orderExpiryMinutes * 60 * 1000);

const isExpiredPendingFusionTransaction = (txn, now = new Date()) =>
  Boolean(
    txn &&
    txn.provider === 'Fusion' &&
    txn.type === 'deposit' &&
    txn.status === 'pending' &&
    txn.createdAt &&
    new Date(txn.createdAt).getTime() <= getExpiryCutoff(now).getTime()
  );

const markTransactionExpired = async (txn, reason = 'Fusion order expired after 1 minute', session) => {
  if (!txn || txn.status !== 'pending') return txn;

  const processedAt = new Date();
  txn.status = 'expired';
  txn.failureReason = reason;
  txn.completedAt = processedAt;
  txn.rawCallback = txn.rawCallback || { status: 'expired_local' };
  if (session) {
    await txn.save({ session });
  } else {
    await txn.save();
  }
  return txn;
};

const callbackUrl = () => {
  const base = `${config.fusion.callbackBaseUrl}${config.apiPrefix}/wallet/billOrder/callback`;
  return config.fusion.callbackSecret
    ? `${base}?secret=${encodeURIComponent(config.fusion.callbackSecret)}`
    : base;
};

const mapStatus = (raw) => {
  const status = String(raw || '').toLowerCase();
  if (status === 'approved' || status === 'success' || status === 'completed') return 'completed';
  if (status === 'declined' || status === 'failed' || status === 'cancelled') return 'failed';
  return 'pending';
};

const createBillOrder = async (user, payload) => {
  const email = payload.email || user.email;
  if (!email) {
    throw ApiError.badRequest('Email is required for Fusion bill-order deposits');
  }
  const walletType = normalizeWalletType(payload.walletType || user.activeWallet);

  const externalRef = payload.external_ref || makeRef();
  const billOrderPayload = {
    amount: payload.amount,
    currency: payload.currency || config.fusion.currency,
    comment: payload.comment || externalRef,
    email,
    description: payload.description || `Betnare wallet deposit ${externalRef}`,
    external_ref: externalRef,
    callback_url: payload.callback_url || callbackUrl(),
  };

  const txn = await Transaction.create({
    user: user._id,
    type: 'deposit',
    amount: payload.amount,
    currency: billOrderPayload.currency,
    walletType,
    provider: 'Fusion',
    phone: user.phone,
    externalId: externalRef,
  });

  try {
    const providerResponse = await fusion.createBillOrder(billOrderPayload);
    const order = getFusionOrder(providerResponse);
    txn.providerResponse = providerResponse;
    txn.secureId =
      order?.ID != null ? String(order.ID) :
      order?.id != null ? String(order.id) :
      providerResponse.secureId ||
      providerResponse.bill_order_id ||
      providerResponse.billOrderId ||
      providerResponse.id != null ? String(providerResponse.id) :
      null;
    if (order?.external_ref) txn.externalId = order.external_ref;
    if (order?.comment_ref && !txn.receipt) txn.receipt = order.comment_ref;
    await txn.save();

    return {
      transaction: txn.toJSON(),
      provider: providerResponse,
    };
  } catch (err) {
    txn.status = 'failed';
    txn.failureReason = err.message;
    await txn.save();
    throw err;
  }
};

const splitName = (name = '') => {
  const cleaned = String(name || '').trim();
  if (!cleaned) return { firstName: null, lastName: null };

  const parts = cleaned.split(/\s+/);
  const [firstName, ...rest] = parts;
  return {
    firstName: firstName || null,
    lastName: rest.join(' ') || 'Customer',
  };
};

const createCardPaymentLink = async (user, payload) => {
  const email = payload.email || user.email;
  if (!email) {
    throw ApiError.badRequest('Email is required for card deposits');
  }
  const walletType = normalizeWalletType(payload.walletType || user.activeWallet);

  const inferredName = splitName(user.name);
  const firstName = payload.first_name || inferredName.firstName || 'Betnare';
  const lastName = payload.last_name || inferredName.lastName || 'Customer';
  const externalRef = payload.external_ref || makeCardRef();
  const redirectUrl = payload.redirect_url || config.transactpay.redirectUrl;
  const currency = String(payload.currency || config.transactpay.currency).toUpperCase();
  const country = String(payload.country || config.transactpay.defaultCountry).toUpperCase();

  const providerPayload = {
    customer: {
      firstname: firstName,
      lastname: lastName,
      mobile: payload.phone || user.phone,
      country,
      email,
    },
    order: {
      amount: payload.amount,
      reference: externalRef,
      description: payload.description || `Betnare wallet card deposit ${externalRef}`,
      currency,
    },
    payment: {
      RedirectUrl: redirectUrl,
    },
  };

  const txn = await Transaction.create({
    user: user._id,
    type: 'deposit',
    amount: payload.amount,
    currency,
    walletType,
    provider: 'TransactPay',
    phone: payload.phone || user.phone,
    externalId: externalRef,
  });

  try {
    const providerResponse = await transactpay.createPaymentLink(providerPayload);
    if (!providerResponse?.isSuccess || !providerResponse?.redirectUrl) {
      throw new ApiError(
        502,
        providerResponse?.message || 'TransactPay did not return a redirect URL',
        providerResponse
      );
    }

    txn.providerResponse = providerResponse;
    txn.secureId = providerResponse.orderId != null ? String(providerResponse.orderId) : null;
    await txn.save();

    return {
      transaction: txn.toJSON(),
      redirectUrl: providerResponse.redirectUrl,
      provider: providerResponse,
    };
  } catch (err) {
    txn.status = 'failed';
    txn.failureReason = err.message;
    await txn.save();
    throw err;
  }
};

const findCallbackTransaction = async (payload, session) => {
  const query = payload.external_ref
    ? { externalId: payload.external_ref, provider: 'Fusion', type: 'deposit' }
    : payload.order_id != null
      ? { secureId: String(payload.order_id), provider: 'Fusion', type: 'deposit' }
      : null;

  if (!query) return null;

  const finder = Transaction.findOne(query);
  if (session) finder.session(session);
  return finder;
};

const validateCallbackForTxn = (txn, payload) => {
  if (!txn) {
    logger.warn('Fusion callback for unknown transaction', payload.external_ref || payload.order_id);
    return { ok: false, reason: 'unknown transaction' };
  }

  if (payload.amount != null && Number(payload.amount) !== Number(txn.amount)) {
    logger.warn('Fusion callback amount mismatch', payload.external_ref, payload.amount, txn.amount);
    return { ok: false, reason: 'amount mismatch' };
  }

  if (payload.currency && String(payload.currency).toUpperCase() !== String(txn.currency).toUpperCase()) {
    logger.warn('Fusion callback currency mismatch', payload.external_ref, payload.currency, txn.currency);
    return { ok: false, reason: 'currency mismatch' };
  }

  return null;
};

const buildCallbackUpdate = (status, payload, processedAt, walletAppliedAt = null) => ({
  status,
  receipt: payload.comment_ref
    ? String(payload.comment_ref)
    : payload.order_id != null
      ? String(payload.order_id)
      : null,
  failureReason: status === 'failed' ? `Fusion order ${payload.status}` : null,
  rawCallback: payload,
  completedAt: status === 'pending' ? null : processedAt,
  walletAppliedAt,
});

const shouldApplyToWallet = (txn, status) => txn.type === 'deposit' && status === 'completed';

const handleCallbackInSession = async (session, payload, status) => {
  const txn = await findCallbackTransaction(payload, session);
  const invalid = validateCallbackForTxn(txn, payload);
  if (invalid) return invalid;

  if (isExpiredPendingFusionTransaction(txn)) {
    await markTransactionExpired(txn, `Fusion order expired after ${config.fusion.orderExpiryMinutes} minute(s)`, session);
    logger.info('Late Fusion callback ignored for expired transaction', txn.externalId, payload.status);
    return { ok: true, status: 'expired', idempotent: true };
  }

  if (txn.status !== 'pending') {
    logger.info('Duplicate Fusion callback ignored', txn.externalId, txn.status);
    return { ok: true, status: txn.status, idempotent: true };
  }

  const processedAt = new Date();
  const appliesToWallet = shouldApplyToWallet(txn, status);

  if (appliesToWallet) {
    const wallet = await User.updateOne({ _id: txn.user }, incWalletBalance(txn.walletType, txn.amount), { session });
    if (wallet.matchedCount !== 1) throw new Error(`Wallet user not found for ${txn.externalId}`);
    txn.walletAppliedAt = processedAt;
  }

  Object.assign(txn, buildCallbackUpdate(status, payload, processedAt, txn.walletAppliedAt));
  if (payload.order_id != null) txn.secureId = String(payload.order_id);
  if (payload.comment_ref) txn.receipt = payload.comment_ref;
  await txn.save({ session });

  logger.info(
    appliesToWallet ? 'Fusion deposit credited' : 'Fusion callback processed',
    txn.externalId,
    status
  );

  return { ok: true, status };
};

const handleCallbackCompensating = async (payload, status) => {
  const txn = await findCallbackTransaction(payload);
  const invalid = validateCallbackForTxn(txn, payload);
  if (invalid) return invalid;

  if (isExpiredPendingFusionTransaction(txn)) {
    const updated = await Transaction.findOneAndUpdate(
      { _id: txn._id, status: 'pending' },
      {
        $set: {
          status: 'expired',
          failureReason: `Fusion order expired after ${config.fusion.orderExpiryMinutes} minute(s)`,
          completedAt: new Date(),
          rawCallback: payload,
        },
      },
      { new: true }
    ).lean();
    logger.info('Late Fusion callback ignored for expired transaction', txn.externalId, payload.status);
    return { ok: true, status: updated?.status || 'expired', idempotent: true };
  }

  if (txn.status !== 'pending') {
    logger.info('Duplicate Fusion callback ignored', txn.externalId, txn.status);
    return { ok: true, status: txn.status, idempotent: true };
  }

  const processedAt = new Date();
  const appliesToWallet = shouldApplyToWallet(txn, status);
  const update = buildCallbackUpdate(
    status,
    payload,
    processedAt,
    appliesToWallet ? processedAt : null
  );

  if (payload.order_id != null) update.secureId = String(payload.order_id);
  if (payload.comment_ref) update.receipt = payload.comment_ref;

  const updated = await Transaction.findOneAndUpdate(
    { _id: txn._id, status: 'pending' },
    { $set: update },
    { new: true }
  ).lean();

  if (!updated) {
    const current = await Transaction.findById(txn._id).lean();
    logger.info('Duplicate Fusion callback ignored', txn.externalId, current?.status);
    return { ok: true, status: current?.status || 'unknown', idempotent: true };
  }

  if (appliesToWallet) {
    const wallet = await User.updateOne({ _id: txn.user }, incWalletBalance(txn.walletType, txn.amount));
    if (wallet.matchedCount !== 1) throw new Error(`Wallet user not found for ${txn.externalId}`);
  }

  logger.info(
    appliesToWallet ? 'Fusion deposit credited' : 'Fusion callback processed',
    txn.externalId,
    status
  );

  return { ok: true, status };
};

const handleCallback = async (payload) => {
  if (!payload.external_ref && payload.order_id == null) {
    logger.warn('Fusion callback missing transaction identifiers', payload);
    return { ok: false, reason: 'missing transaction identifier' };
  }

  const status = mapStatus(payload.status);
  if (status === 'pending') {
    logger.info('Fusion callback still pending, ignoring', payload.external_ref || payload.order_id);
    return { ok: true, status: 'pending' };
  }

  return withTransaction(
    (session) => handleCallbackInSession(session, payload, status),
    () => handleCallbackCompensating(payload, status)
  );
};

module.exports = {
  createBillOrder,
  createCardPaymentLink,
  handleCallback,
  callbackUrl,
  isExpiredPendingFusionTransaction,
  markTransactionExpired,
};
