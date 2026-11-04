'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/transaction/transaction.service');

const loadService = ({ transferResponse }) => {
  const originalLoad = Module._load;
  const state = { txns: [], userUpdates: [], floatSettled: [], notifications: [] };

  const lean = (value) => ({ lean: async () => value });
  const mocks = {
    '../../config': () => ({
      apiPrefix: '/api/v1',
      mamlaka: { merchantId: 'm', callbackBaseUrl: 'http://x', callbackSecret: '', currency: 'KES', defaultProvider: 'M-Pesa' },
      referral: { qualifyingDepositAmount: 100, bonusAmount: 20 },
    }),
    '../../utils/logger': () => ({ info() {}, warn() {}, error() {} }),
    '../../integrations/mamlaka/mamlaka.client': () => ({ initiateTransfer: async () => transferResponse }),
    '../../utils/phone': () => ({ normalizePhone: (p) => String(p).replace(/\D/g, '').replace(/^0/, '254') }),
    '../../services/sms.service': () => ({ sendTransactionStatus: async () => {} }),
    './transaction.model': () => ({
      create: async (payload) => {
        const txn = {
          _id: 'txn-1', ...payload, status: 'pending', walletAppliedAt: null,
          async save() {}, toJSON() { return { ...this }; },
        };
        state.txns.push(txn);
        return txn;
      },
      findOne: () => lean(state.txns[0] && { ...state.txns[0] }),
      findById: () => lean(state.txns[0] && { ...state.txns[0] }),
      findOneAndUpdate: (_query, update) => {
        Object.assign(state.txns[0], update.$set);
        return lean({ ...state.txns[0] });
      },
    }),
    '../user/user.model': () => ({
      findOneAndUpdate: () => lean({ _id: 'user-1' }),
      updateOne: async (query, update) => { state.userUpdates.push({ query, update }); return { matchedCount: 1 }; },
    }),
    '../admin/payoutFloat.service': () => ({
      requirePayoutCapacity: async () => {},
      settlePayout: async (ref, opts) => { state.floatSettled.push({ ref, ...opts }); },
    }),
    '../notification/notification.service': () => ({
      create: async (n) => { state.notifications.push(n); },
    }),
    '../../utils/db': () => ({
      withTransaction: async (_txnFn, fallback) => fallback(),
      incWalletBalance: (type, delta) => [{ delta, type }],
      normalizeWalletType: (t) => (t === 'airtime' ? 'airtime' : 'balance'),
      walletBalanceField: () => 'balance',
      walletBalanceQuery: (_t, amount) => ({ balance: { $gte: amount } }),
    }),
    '../user/referral': () => ({ qualifiesForReferralBonus: () => false }),
    '../wallet/wallet.service': () => ({ isExpiredPendingCometTransaction: () => false, markTransactionExpired: async () => {} }),
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === servicePath && mocks[request]) return mocks[request]();
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  const service = require(servicePath);
  Module._load = originalLoad;
  return { service, state };
};

test('a payout refused for insufficient provider balance is failed, refunded and flagged', async () => {
  const { service, state } = loadService({
    transferResponse: {
      error: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient KES balance. Available: 169.00 KES, Required: 220.00 KES',
      status: 'FAILED',
    },
  });

  const result = await service.withdraw({ _id: 'user-1' }, { amount: 220, phone: '0712345678' });

  assert.equal(result.status, 'failed');
  // The player is told a generic reason, never the provider's internal balance.
  assert.match(result.failureReason, /temporarily unavailable/);
  assert.doesNotMatch(result.failureReason, /169/);
  // The debited 220 went back to the player (second user update is the refund).
  assert.equal(state.userUpdates.length, 1);
  assert.deepEqual(state.userUpdates[0].update, [{ delta: 220, type: 'balance' }]);
  // The reserved float was released, not spent.
  assert.deepEqual(state.floatSettled.map((s) => s.refund), [true]);
  // Staff get a critical notification.
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].severity, 'critical');
});

test('a payout the provider accepts stays pending', async () => {
  const { service, state } = loadService({
    transferResponse: { secureId: 'sec-1', status: 'PENDING' },
  });

  const result = await service.withdraw({ _id: 'user-1' }, { amount: 100, phone: '0712345678' });

  assert.equal(result.status, 'pending');
  assert.equal(state.userUpdates.length, 0);
  assert.equal(state.floatSettled.length, 0);
});
