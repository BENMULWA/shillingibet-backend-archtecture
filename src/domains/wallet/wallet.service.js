'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/ApiError');
const config = require('../../config');
const logger = require('../../utils/logger');
const {
  withTransaction,
  incWalletBalance,
  normalizeWalletType,
  walletBalanceQuery,
} = require('../../utils/db');
const fusion = require('../../integrations/fusion/fusion.client');
const transactpay = require('../../integrations/transactpay/transactpay.client');
const mamlakaCelo = require('../../integrations/mamlaka/celo.client');
const Transaction = require('../transaction/transaction.model');
const User = require('../user/user.model');

const makeRef = () => `FUS-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const makeCardRef = () => `CARD-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const makeCeloRef = () => `CELO-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

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

const getCeloDepositInstructions = (user, asset = 'USDT') =>
  mamlakaCelo.getDepositInstructions(user._id, asset);

const withdrawCelo = async (user, payload) => {
  const asset = payload.asset || 'USDT';
  const usdcAmount = Number(payload.amount);

  // Live, margin-adjusted rate from the gateway itself rather than a
  // locally configured constant — keeps this in sync with what the
  // gateway will actually credit/settle, instead of drifting apart over time.
  const quote = await mamlakaCelo.getQuote({ amount: usdcAmount, from: asset, to: 'KES' });
  const rate = Number(quote.rate);
  if (!rate) {
    throw new ApiError(503, `${asset} to KES withdrawal rate is not available`);
  }
  const debitAmountKes = Number((quote.to_amount ?? usdcAmount * rate).toFixed(2));
  const externalId = makeCeloRef();

  const debited = await User.findOneAndUpdate(
    { _id: user._id, ...walletBalanceQuery('balance', debitAmountKes) },
    incWalletBalance('balance', -debitAmountKes),
    { new: true }
  ).lean();
  if (!debited) throw ApiError.badRequest('Insufficient main wallet balance');

  let txn;
  try {
    txn = await Transaction.create({
      user: user._id,
      type: 'withdrawal',
      amount: debitAmountKes,
      currency: 'KES',
      walletType: 'balance',
      provider: 'Mamlaka Celo',
      phone: user.phone,
      externalId,
    });

    const providerResponse = await mamlakaCelo.withdraw({
      externalUserId: user._id,
      asset,
      toAddress: payload.to_address,
      amount: usdcAmount,
      // Reuse this same externalId if this function is ever retried for the
      // same logical withdrawal attempt — that's what lets the gateway
      // replay the original result instead of double-sending.
      idempotencyKey: externalId,
    });
    const rawStatus = String(providerResponse.status || providerResponse.transaction_status || '').toLowerCase();
    const failed = ['failed', 'rejected', 'cancelled'].includes(rawStatus);
    if (failed) {
      throw new ApiError(502, providerResponse.message || 'Valora withdrawal was rejected');
    }

    const completed = ['complete', 'completed', 'success', 'successful'].includes(rawStatus);
    txn.status = completed ? 'completed' : 'pending';
    txn.secureId =
      providerResponse.withdrawal_id ||
      providerResponse.id ||
      providerResponse.transaction_id ||
      null;
    txn.receipt =
      providerResponse.transaction_hash ||
      providerResponse.tx_hash ||
      providerResponse.hash ||
      null;
    txn.providerResponse = {
      ...providerResponse,
      requestedUsdc: usdcAmount,
      usdcKesRate: rate,
      debitAmountKes,
      toAddress: payload.to_address,
    };
    if (completed) {
      txn.completedAt = new Date();
      txn.walletAppliedAt = txn.completedAt;
    }
    await txn.save();

    return {
      transaction: txn.toJSON(),
      amountUsdc: usdcAmount,
      debitAmountKes,
      rate,
      provider: providerResponse,
    };
  } catch (error) {
    await User.updateOne({ _id: user._id }, incWalletBalance('balance', debitAmountKes));
    if (txn) {
      txn.status = 'failed';
      txn.failureReason = error.message;
      txn.completedAt = new Date();
      txn.walletAppliedAt = txn.completedAt;
      await txn.save();
    }
    throw error;
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

// ======================================================================
// Celo gateway webhook — deposit.credited / withdrawal.completed /
// withdrawal.failed / swap.completed, signature-verified by
// verifyCeloGatewaySignature before this is ever called.
// ======================================================================

const applyCeloDepositCredit = async (payload) => {
  const { externalUserId, asset, amount, txHash, kesAmount } = payload;

  if (!externalUserId || !txHash) {
    logger.warn('Celo deposit webhook missing externalUserId/txHash', payload);
    return { ok: false, reason: 'missing identifiers' };
  }

  if (kesAmount == null) {
    // The gateway couldn't quote KES at credit time (FX API down with no
    // cache yet) — the crypto deposit itself is still safely credited on
    // the gateway's own ledger. Guessing a rate here would risk crediting
    // the wrong KES amount, so this is left for manual reconciliation
    // instead.
    logger.warn('Celo deposit webhook missing kesAmount, skipping wallet credit', txHash);
    return { ok: true, status: 'no_kes_quote', idempotent: false };
  }

  const user = await User.findById(externalUserId).lean();
  if (!user) {
    logger.warn('Celo deposit webhook for unknown user', externalUserId, txHash);
    return { ok: false, reason: 'unknown user' };
  }

  const kesCredit = Number(Number(kesAmount).toFixed(2));

  // Transaction.externalId has a unique index — that's the real dedupe
  // guard (atomic), not the absence of a prior find(). Webhook delivery
  // from the gateway isn't guaranteed exactly-once, and this also covers a
  // retried delivery landing here twice concurrently.
  let txn;
  try {
    txn = await Transaction.create({
      user: user._id,
      type: 'deposit',
      status: 'completed',
      amount: kesCredit,
      currency: 'KES',
      walletType: 'balance',
      provider: 'Mamlaka Celo',
      phone: user.phone,
      externalId: txHash,
      receipt: txHash,
      providerResponse: payload,
      completedAt: new Date(),
      walletAppliedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      logger.info('Duplicate Celo deposit webhook ignored', txHash);
      return { ok: true, status: 'completed', idempotent: true };
    }
    throw err;
  }

  await User.updateOne({ _id: user._id }, incWalletBalance('balance', kesCredit));

  logger.info(
    'Celo deposit credited via webhook',
    externalUserId,
    asset,
    amount,
    '->',
    kesCredit,
    'KES',
    txHash
  );

  return { ok: true, status: 'completed', transactionId: txn._id };
};

const reconcileCeloWithdrawal = async (payload, event) => {
  const { txHash } = payload;
  if (!txHash) return { ok: true, handled: false };

  // withdrawCelo() above already applies the synchronous HTTP response from
  // /api/celo/withdraw, so this webhook is normally just a confirmatory
  // echo of a withdrawal this service already recorded. Nothing to do if no
  // matching record exists (e.g. a withdrawal initiated some other way).
  const txn = await Transaction.findOne({ receipt: txHash, provider: 'Mamlaka Celo', type: 'withdrawal' });
  if (!txn) return { ok: true, handled: false };

  const nextStatus = event === 'withdrawal.completed' ? 'completed' : 'failed';
  if (txn.status !== nextStatus) {
    txn.status = nextStatus;
    if (event === 'withdrawal.failed') {
      txn.failureReason = payload.error || 'Reported failed by gateway webhook';
    }
    await txn.save();
  }

  return { ok: true, status: nextStatus, transactionId: txn._id };
};

const handleCeloWebhook = async (payload) => {
  const event = payload.event;
  logger.info('Celo gateway webhook received', event, payload.externalUserId);

  if (event === 'deposit.credited') return applyCeloDepositCredit(payload);
  if (event === 'withdrawal.completed' || event === 'withdrawal.failed') {
    return reconcileCeloWithdrawal(payload, event);
  }

  // swap.completed and anything else: acknowledged, no local action needed.
  return { ok: true, event, handled: false };
};

module.exports = {
  createBillOrder,
  createCardPaymentLink,
  getCeloDepositInstructions,
  withdrawCelo,
  handleCeloWebhook,
  handleCallback,
  callbackUrl,
  isExpiredPendingFusionTransaction,
  markTransactionExpired,
};
