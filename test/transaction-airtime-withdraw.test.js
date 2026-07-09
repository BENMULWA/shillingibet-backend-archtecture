'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/transaction/transaction.service');

const loadService = ({ airtimeResponse, airtimeError } = {}) => {
  const originalLoad = Module._load;
  const state = {
    createdTransactions: [],
    userUpdates: [],
    airtimePayload: null,
    smsPayloads: [],
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../config' && parent?.filename === servicePath) {
      return {
        apiPrefix: '/api/v1',
        mamlaka: {
          merchantId: 'shilingibet',
          callbackBaseUrl: 'http://localhost:5050',
          callbackSecret: '',
          currency: 'KES',
          defaultProvider: 'AIRTEL',
        },
        referral: { qualifyingDepositAmount: 100, bonusAmount: 20 },
      };
    }

    if (request === '../../utils/logger' && parent?.filename === servicePath) {
      return { info() {}, warn() {}, error() {} };
    }

    if (request === '../../integrations/mamlaka/mamlaka.client' && parent?.filename === servicePath) {
      return {
        initiateAirtime: async (payload) => {
          state.airtimePayload = payload;
          if (airtimeError) throw airtimeError;
          return airtimeResponse;
        },
      };
    }

    if (request === '../../utils/phone' && parent?.filename === servicePath) {
      return {
        normalizePhone(phone) {
          return String(phone).replace(/\D/g, '').replace(/^0/, '254');
        },
      };
    }

    if (request === '../../services/sms.service' && parent?.filename === servicePath) {
      return {
        sendTransactionStatus: async (payload) => {
          state.smsPayloads.push(payload);
        },
      };
    }

    if (request === './transaction.model' && parent?.filename === servicePath) {
      return {
        create: async (payload) => {
          const txn = {
            ...payload,
            status: 'pending',
            saveCalls: 0,
            async save() {
              this.saveCalls += 1;
            },
            toJSON() {
              return { ...this, save: undefined, toJSON: undefined };
            },
          };
          state.createdTransactions.push(txn);
          return txn;
        },
      };
    }

    if (request === '../user/user.model' && parent?.filename === servicePath) {
      return {
        findOneAndUpdate(query, update) {
          state.userUpdates.push({ query, update });
          return {
            lean: async () => ({ _id: 'user-1' }),
          };
        },
        updateOne: async (query, update) => {
          state.userUpdates.push({ query, update, refund: true });
          return { matchedCount: 1 };
        },
      };
    }

    if (request === '../../utils/db' && parent?.filename === servicePath) {
      return {
        withTransaction: async () => {},
        incWalletBalance(walletType, delta) {
          const field = walletType === 'airtime' ? 'airtimeBalance' : 'balance';
          return [{ $set: { [field]: { $round: [{ $add: [`$${field}`, delta] }, 2] } } }];
        },
        normalizeWalletType(walletType) {
          return walletType === 'airtime' ? 'airtime' : 'balance';
        },
        walletBalanceField(walletType) {
          return walletType === 'airtime' ? 'airtimeBalance' : 'balance';
        },
        walletBalanceQuery(walletType, amount) {
          const field = walletType === 'airtime' ? 'airtimeBalance' : 'balance';
          return { [field]: { $gte: amount } };
        },
      };
    }

    if (
      request === '../user/referral' ||
      request === '../wallet/wallet.service'
    ) {
      return {
        qualifiesForReferralBonus() { return false; },
        isExpiredPendingFusionTransaction() { return false; },
        markTransactionExpired: async () => {},
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[servicePath];
  try {
    return { service: require(servicePath), state };
  } finally {
    Module._load = originalLoad;
  }
};

test('airtime withdrawal debits airtimeBalance and marks transaction completed on immediate success', async () => {
  const { service, state } = loadService({
    airtimeResponse: {
      status: 'success',
      message: 'Airtime disbursed successful',
      secureId: 'qdml8553ZeInavKorBHzLA==',
      transactionId: 'AIRTIME-001',
    },
  });

  const txn = await service.withdraw(
    { _id: 'user-1', email: 'customer@example.com', activeWallet: 'balance' },
    { amount: 10, phone: '0768899729', provider: 'AIRTEL', walletType: 'airtime' }
  );

  assert.deepEqual(state.userUpdates[0].query, { _id: 'user-1', airtimeBalance: { $gte: 10 } });
  assert.equal(state.airtimePayload.phone, '254768899729');
  assert.equal(state.airtimePayload.email, 'customer@example.com');
  assert.equal(state.createdTransactions[0].currency, 'ARTM');
  assert.equal(state.createdTransactions[0].walletType, 'airtime');
  assert.equal(txn.status, 'completed');
  assert.equal(txn.receipt, 'AIRTIME-001');
  assert.equal(state.smsPayloads.length, 1);
});

test('airtime withdrawal refunds airtimeBalance on immediate failure', async () => {
  const { service, state } = loadService({
    airtimeResponse: {
      status: 'failed',
      message: 'Airtime disbursion failed',
      secureId: 'qdml8553ZeInavKorBHzLA==',
      transactionId: 'AIRTIME-002',
    },
  });

  const txn = await service.withdraw(
    { _id: 'user-1', email: 'customer@example.com', activeWallet: 'airtime' },
    { amount: 10, phone: '254768899729', provider: 'AIRTEL' }
  );

  assert.equal(txn.status, 'failed');
  assert.equal(state.userUpdates.length, 2);
  assert.equal(state.userUpdates[1].refund, true);
  assert.equal(state.smsPayloads.length, 1);
});
