'use strict';

const mongoose = require('mongoose');
const logger = require('./logger');

let transactionsSupported = null;
const WALLET_TYPES = ['balance', 'airtime'];

const isTransactionUnsupported = (err) =>
  err?.code === 20 ||
  err?.codeName === 'IllegalOperation' ||
  /Transaction numbers are only allowed|replica set|mongos|Transactions are not supported|sessions are not supported/i.test(
    err?.message || ''
  );

const runTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
};

const withTransaction = async (txnFn, fallbackFn) => {
  if (transactionsSupported === false) return fallbackFn();

  try {
    const result = await runTransaction(txnFn);
    transactionsSupported = true;
    return result;
  } catch (err) {
    if (isTransactionUnsupported(err)) {
      if (transactionsSupported !== false) {
        transactionsSupported = false;
        logger.warn('MongoDB transactions unavailable; falling back to compensating writes. Run Mongo as a replica set for full atomicity.');
      }
      return fallbackFn();
    }
    throw err;
  }
};

const normalizeWalletType = (walletType) => {
  const normalized = String(walletType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (normalized === 'airtime' || normalized === 'airtimebalance' || normalized === 'airtimewallet') {
    return 'airtime';
  }

  return 'balance';
};

const walletBalanceField = (walletType) =>
  normalizeWalletType(walletType) === 'airtime' ? 'airtimeBalance' : 'balance';

const walletBalanceQuery = (walletType, amount) => ({
  [walletBalanceField(walletType)]: { $gte: amount },
});

const incWalletBalance = (walletType, delta) => {
  const field = walletBalanceField(walletType);
  return [
    { $set: { [field]: { $round: [{ $add: [`$${field}`, delta] }, 2] } } },
  ];
};

const incBalance = (delta) => incWalletBalance('balance', delta);

module.exports = {
  WALLET_TYPES,
  runTransaction,
  withTransaction,
  isTransactionUnsupported,
  incBalance,
  incWalletBalance,
  normalizeWalletType,
  walletBalanceField,
  walletBalanceQuery,
};
