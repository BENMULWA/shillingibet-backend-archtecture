'use strict';

const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');
const {
  withTransaction,
  incWalletBalance,
  normalizeWalletType,
  walletBalanceField,
  walletBalanceQuery,
} = require('../../utils/db');
const mamlaka = require('../../integrations/mamlaka/mamlaka.client');
const { normalizePhone } = require('../../utils/phone');
const smsService = require('../../services/sms.service');
const Transaction = require('./transaction.model');
const User = require('../user/user.model');
const { qualifiesForReferralBonus } = require('../user/referral');
const {
  isExpiredPendingFusionTransaction,
  markTransactionExpired,
} = require('../wallet/wallet.service');

const makeRef = (prefix) => `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

const callbackUrl = () => `${config.mamlaka.callbackBaseUrl}/callbacks/mamlaka`;

const deposit = async (user, { amount, phone, provider, walletType: requestedWalletType }) => {
  const payerPhone = normalizePhone(phone);
  const mobileMoneySP = provider || config.mamlaka.defaultProvider;
  const externalId = makeRef('DEP');
  const walletType = normalizeWalletType(requestedWalletType || user.activeWallet);

  const txn = await Transaction.create({
    user: user._id,
    type: 'deposit',
    amount,
    currency: config.mamlaka.currency,
    walletType,
    provider: mobileMoneySP,
    phone: payerPhone,
    externalId,
  });

  try {
    const res = await mamlaka.initiateCollection({
      impalaMerchantId: config.mamlaka.merchantId,
      displayName: config.mamlaka.displayName,
      currency: config.mamlaka.currency,
      amount,
      payerPhone,
      mobileMoneySP,
      externalId,
      callbackUrl: callbackUrl('deposit'),
    });

    txn.secureId = res.secureId || null;
    await txn.save();
    return txn.toJSON();
  } catch (err) {
    txn.status = 'failed';
    txn.failureReason = err.message;
    await txn.save();
    throw err;
  }
};

const withdraw = async (user, { amount, phone, provider, walletType: requestedWalletType }) => {
  const recipientPhone = normalizePhone(phone);
  const mobileMoneySP = provider || config.mamlaka.defaultProvider;
  const walletType = normalizeWalletType(requestedWalletType || user.activeWallet);
  const isAirtimeWithdrawal = walletType === 'airtime';
  const externalId = makeRef(isAirtimeWithdrawal ? 'ART' : 'WDR');
  const currency = isAirtimeWithdrawal ? 'ARTM' : config.mamlaka.currency;
  const balanceField = walletBalanceField(walletType);

  const debited = await User.findOneAndUpdate(
    { _id: user._id, ...walletBalanceQuery(walletType, amount) },
    incWalletBalance(walletType, -amount),
    { new: true }
  ).lean();
  if (!debited) {
    throw ApiError.badRequest(
      isAirtimeWithdrawal ? 'Insufficient airtime balance' : 'Insufficient balance'
    );
  }

  let txn;
  try {
    txn = await Transaction.create({
      user: user._id,
      type: 'withdrawal',
      amount,
      currency,
      walletType,
      provider: mobileMoneySP,
      phone: recipientPhone,
      externalId,
    });

    const res = isAirtimeWithdrawal
      ? await mamlaka.initiateAirtime({
          impalaMerchantId: config.mamlaka.merchantId,
          amount,
          phone: recipientPhone,
          mobileMoneySP,
          externalId,
          ...(user.email ? { email: user.email } : {}),
        })
      : await mamlaka.initiateTransfer({
          impalaMerchantId: config.mamlaka.merchantId,
          currency: config.mamlaka.currency,
          amount,
          recipientPhone,
          mobileMoneySP,
          externalId,
          callbackUrl: callbackUrl('withdraw'),
        });

    txn.secureId = res.secureId || null;
    txn.providerResponse = res;

    if (isAirtimeWithdrawal) {
      const status = mapStatus(res.transactionStatus || res.status);
      const processedAt = status === 'pending' ? null : new Date();

      txn.status = status;
      txn.receipt = res.transactionReceipt || res.transactionId || res.reference || null;
      txn.failureReason = status === 'failed' ? res.reason || res.message || 'failed' : null;
      txn.rawCallback = res;
      txn.completedAt = processedAt;

      if (status === 'failed') {
        await User.updateOne({ _id: user._id }, incWalletBalance(walletType, amount));
        txn.walletAppliedAt = processedAt;
      }
      if (status === 'completed') {
        txn.walletAppliedAt = processedAt;
      }
    }

    await txn.save();

    if (isAirtimeWithdrawal && txn.status !== 'pending') {
      await smsService.sendTransactionStatus({
        phone: txn.phone,
        type: txn.type,
        amount: txn.amount,
        status: txn.status,
        receipt: txn.receipt,
        failureReason: txn.failureReason,
        currency: txn.currency,
        walletType: txn.walletType,
      });
    }

    return txn.toJSON();
  } catch (err) {
    await User.updateOne({ _id: user._id }, incWalletBalance(walletType, amount));
    if (txn) {
      txn.status = 'failed';
      txn.failureReason = err.message;
      await txn.save();
    }
    throw err;
  }
};

const mapStatus = (raw) => {
  const s = String(raw || '').toUpperCase();
  if (s === 'COMPLETE' || s === 'COMPLETED' || s === 'SUCCESS') return 'completed';
  if (s === 'FAILED' || s === 'FAIL' || s === 'CANCELLED') return 'failed';
  return 'pending';
};

const buildCallbackUpdate = (status, payload, processedAt, walletAppliedAt = null) => ({
  status,
  receipt: payload.transactionReceipt || payload.transactionId || payload.reference || null,
  failureReason: status === 'failed' ? payload.reason || payload.transactionReport || 'failed' : null,
  rawCallback: payload,
  completedAt: processedAt,
  walletAppliedAt,
});

const validateCallbackForTxn = (txn, type, payload, expectedType) => {
  if (!txn) {
    logger.warn('Callback for unknown transaction', payload.externalId);
    return { ok: false, reason: 'unknown transaction' };
  }

  if (txn.type !== expectedType) {
    logger.warn('Callback type mismatch', payload.externalId, type, txn.type);
    return { ok: false, reason: 'transaction type mismatch' };
  }

  if (txn.secureId && payload.secureId && txn.secureId !== payload.secureId) {
    logger.warn('Callback secureId mismatch', payload.externalId);
    return { ok: false, reason: 'secureId mismatch' };
  }

  if (payload.amount != null && Number(payload.amount) !== txn.amount) {
    logger.warn('Callback amount mismatch', payload.externalId, payload.amount, txn.amount);
    return { ok: false, reason: 'amount mismatch' };
  }

  return null;
};

const shouldApplyToWallet = (txn, status) =>
  (txn.type === 'deposit' && status === 'completed') ||
  (txn.type === 'withdrawal' && status === 'failed');

const sumCompletedDeposits = async (userId, session) => {
  const query = Transaction.aggregate([
    { $match: { user: userId, type: 'deposit', status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  if (session) query.session(session);
  const [row] = await query;
  return Number(row?.total || 0);
};

const maybeAwardReferralBonus = async (txn, processedAt, session) => {
  if (txn.type !== 'deposit') return { awarded: false };

  const referralUserQuery = User.findById(txn.user);
  if (session) referralUserQuery.session(session);
  const referralUser = await referralUserQuery;
  if (!referralUser?.referredBy || referralUser.referralReward?.bonusGrantedAt) {
    return { awarded: false };
  }

  const completedDepositsBeforeCurrent = await sumCompletedDeposits(referralUser._id, session);
  const completedDepositsAfterCurrent = completedDepositsBeforeCurrent + txn.amount;
  if (
    !qualifiesForReferralBonus(
      completedDepositsAfterCurrent,
      config.referral.qualifyingDepositAmount
    )
  ) {
    return { awarded: false, completedDepositsAfterCurrent };
  }

  const claimQuery = User.findOneAndUpdate(
    {
      _id: referralUser._id,
      referredBy: { $ne: null },
      'referralReward.bonusGrantedAt': null,
    },
    {
      $set: {
        'referralReward.qualifyingDepositAt': processedAt,
        'referralReward.bonusGrantedAt': processedAt,
        'referralReward.qualifyingDepositTotal': completedDepositsAfterCurrent,
        'referralReward.bonusAmount': config.referral.bonusAmount,
      },
    },
    { new: true }
  );
  if (session) claimQuery.session(session);
  const claimedReferral = await claimQuery;
  if (!claimedReferral?.referredBy) return { awarded: false, alreadyHandled: true };

  const referrerUpdate = await User.updateOne(
    { _id: claimedReferral.referredBy },
    {
      $inc: {
        balance: config.referral.bonusAmount,
        'referralStats.bonusEarned': config.referral.bonusAmount,
      },
    },
    session ? { session } : undefined
  );
  if (referrerUpdate.matchedCount !== 1) {
    throw new Error(`Referrer not found for referred user ${claimedReferral._id}`);
  }

  logger.info(
    'Referral bonus credited',
    String(claimedReferral.referredBy),
    String(claimedReferral._id),
    config.referral.bonusAmount
  );

  return { awarded: true, completedDepositsAfterCurrent };
};

const handleCallbackInSession = async (session, type, payload, status, expectedType) => {
  const txn = await Transaction.findOne({ externalId: payload.externalId }).session(session);
  const invalid = validateCallbackForTxn(txn, type, payload, expectedType);
  if (invalid) return invalid;

  if (txn.status !== 'pending') {
    logger.info('Duplicate callback ignored', payload.externalId, txn.status);
    return { ok: true, status: txn.status, idempotent: true };
  }

  const appliesToWallet = shouldApplyToWallet(txn, status);
  const processedAt = new Date();

  if (appliesToWallet) {
    const wallet = await User.updateOne(
      { _id: txn.user },
      incWalletBalance(txn.walletType, txn.amount),
      { session }
    );
    if (wallet.matchedCount !== 1) throw new Error(`Wallet user not found for ${payload.externalId}`);
    txn.walletAppliedAt = processedAt;
  }

  if (txn.type === 'deposit' && status === 'completed') {
    await maybeAwardReferralBonus(txn, processedAt, session);
  }

  Object.assign(txn, buildCallbackUpdate(status, payload, processedAt, txn.walletAppliedAt));
  await txn.save({ session });

  logger.info(
    appliesToWallet
      ? txn.type === 'deposit' ? 'Deposit credited' : 'Withdrawal refunded'
      : 'Payment callback processed',
    payload.externalId,
    txn.amount
  );

  return { ok: true, status };
};

const handleCallbackCompensating = async (type, payload, status, expectedType) => {
  const txn = await Transaction.findOne({ externalId: payload.externalId }).lean();
  const invalid = validateCallbackForTxn(txn, type, payload, expectedType);
  if (invalid) return invalid;

  if (txn.status !== 'pending') {
    logger.info('Duplicate callback ignored', payload.externalId, txn.status);
    return { ok: true, status: txn.status, idempotent: true };
  }

  const appliesToWallet = shouldApplyToWallet(txn, status);
  const processedAt = new Date();
  const update = buildCallbackUpdate(
    status,
    payload,
    processedAt,
    appliesToWallet ? processedAt : null
  );

  const updated = await Transaction.findOneAndUpdate(
    { _id: txn._id, status: 'pending' },
    { $set: update },
    { new: true }
  ).lean();

  if (!updated) {
    const current = await Transaction.findById(txn._id).lean();
    logger.info('Duplicate callback ignored', payload.externalId, current?.status);
    return { ok: true, status: current?.status || 'unknown', idempotent: true };
  }

  if (appliesToWallet) {
    const wallet = await User.updateOne({ _id: txn.user }, incWalletBalance(txn.walletType, txn.amount));
    if (wallet.matchedCount !== 1) throw new Error(`Wallet user not found for ${payload.externalId}`);
  }

  if (txn.type === 'deposit' && status === 'completed') {
    await maybeAwardReferralBonus(updated, processedAt);
  }

  logger.info(
    appliesToWallet
      ? txn.type === 'deposit' ? 'Deposit credited' : 'Withdrawal refunded'
      : 'Payment callback processed',
    payload.externalId,
    txn.amount
  );

  return { ok: true, status };
};

const notifyTransactionStatus = async (externalId, status) => {
  if (status === 'pending') return;

  const txn = await Transaction.findOne({ externalId }).lean();
  if (!txn) return;

  await smsService.sendTransactionStatus({
    phone: txn.phone,
    type: txn.type,
    amount: txn.amount,
    status,
    receipt: txn.receipt,
    failureReason: txn.failureReason,
    currency: txn.currency,
    walletType: txn.walletType,
  });
};

const handleCallback = async (type, payload) => {
  const { externalId } = payload;
  if (!externalId) {
    logger.warn('Callback missing externalId', payload);
    return { ok: false, reason: 'missing externalId' };
  }

  const status = mapStatus(payload.transactionStatus || payload.status);
  if (status === 'pending') {
    logger.info('Callback still pending, ignoring', externalId);
    return { ok: true, status: 'pending' };
  }

  const expectedType = type === 'deposit' ? 'deposit' : type === 'withdraw' ? 'withdrawal' : null;
  if (!expectedType) return { ok: false, reason: 'invalid callback type' };

  const result = await withTransaction(
    (session) => handleCallbackInSession(session, type, payload, status, expectedType),
    () => handleCallbackCompensating(type, payload, status, expectedType)
  );

  if (result.ok && !result.idempotent) {
    await notifyTransactionStatus(externalId, status);
  }

  return result;
};

const handleMamlakaCallback = async (payload) => {
  if (!payload?.externalId) return handleCallback(null, payload || {});

  const txn = await Transaction.findOne({ externalId: payload.externalId })
    .select('type')
    .lean();
  if (!txn) {
    logger.warn('Callback for unknown transaction', payload.externalId);
    return { ok: false, reason: 'unknown transaction' };
  }

  return handleCallback(txn.type === 'deposit' ? 'deposit' : 'withdraw', payload);
};

const listForUser = async (userId, { type, status, page, limit }) => {
  const filter = { user: userId };
  if (type) filter.type = type;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  const normalizedItems = await Promise.all(
    items.map(async (txn) => {
      if (!isExpiredPendingFusionTransaction(txn)) return txn;
      const doc = await Transaction.findById(txn._id);
      if (!doc) return txn;
      await markTransactionExpired(
        doc,
        `Fusion order expired after ${config.fusion.orderExpiryMinutes} minute(s)`
      );
      return doc.toObject();
    })
  );

  return { items: normalizedItems, total, page, limit, pages: Math.ceil(total / limit) };
};

const getById = async (userId, id) => {
  let txn = await Transaction.findOne({ _id: id, user: userId }).lean();
  if (!txn) throw ApiError.notFound('Transaction not found');

  if (isExpiredPendingFusionTransaction(txn)) {
    const doc = await Transaction.findById(txn._id);
    if (doc) {
      await markTransactionExpired(
        doc,
        `Fusion order expired after ${config.fusion.orderExpiryMinutes} minute(s)`
      );
      txn = doc.toObject();
    }
  }

  if (txn.status === 'pending' && (txn.secureId || txn.externalId)) {
    try {
      const providerStatus = await mamlaka.getTransactionStatus(txn.secureId || txn.externalId);
      const mappedStatus = mapStatus(providerStatus.transactionStatus || providerStatus.status);

      if (mappedStatus !== 'pending') {
        await handleCallback(txn.type === 'deposit' ? 'deposit' : 'withdraw', {
          ...providerStatus,
          externalId: providerStatus.externalId || txn.externalId,
          secureId: providerStatus.secureId || txn.secureId,
          amount: providerStatus.amount ?? txn.amount,
        });
        txn = await Transaction.findOne({ _id: id, user: userId }).lean();
      }
    } catch (err) {
      logger.warn('Unable to refresh Mamlaka transaction status', txn.externalId, err.message);
    }
  }

  return txn;
};

module.exports = {
  deposit,
  withdraw,
  handleCallback,
  handleMamlakaCallback,
  listForUser,
  getById,
};
