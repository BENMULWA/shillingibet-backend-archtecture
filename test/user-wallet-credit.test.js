'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/user/user.service');

const loadService = ({ existingUser, updatedUser }) => {
  const originalLoad = Module._load;
  const state = {
    findByIdCalls: [],
    findByIdAndUpdateCalls: [],
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../config' && parent?.filename === servicePath) {
      return {
        jwt: { secret: 'secret', expiresIn: '1h' },
        sms: { phoneVerificationTtlMinutes: 10, resetCodeTtlMinutes: 10 },
      };
    }

    if (request === './user.model' && parent?.filename === servicePath) {
      return {
        findById(id) {
          state.findByIdCalls.push(id);
          return {
            select() {
              return { lean: async () => existingUser };
            },
          };
        },
        findByIdAndUpdate(id, update) {
          state.findByIdAndUpdateCalls.push({ id, update });
          return { lean: async () => updatedUser };
        },
      };
    }

    if (request === '../../utils/db' && parent?.filename === servicePath) {
      return {
        incWalletBalance(walletType, amount) {
          const field = walletType === 'airtime' ? 'airtimeBalance' : 'balance';
          return [{ $set: { [field]: { $round: [{ $add: [`$${field}`, amount] }, 2] } } }];
        },
        normalizeWalletType(walletType) {
          const normalized = String(walletType || '')
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, '');
          return normalized === 'airtime' || normalized === 'airtimebalance' || normalized === 'airtimewallet'
            ? 'airtime'
            : 'balance';
        },
      };
    }

    if (
      request === 'jsonwebtoken' ||
      request === '../../utils/logger' ||
      request === '../../utils/phone' ||
      request === '../../services/sms.service' ||
      request === '../../middlewares/auth' ||
      request === './referral'
    ) {
      return {};
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

test('manual credit uses the target user activeWallet when walletType is omitted', async () => {
  const { service, state } = loadService({
    existingUser: { _id: '507f1f77bcf86cd799439011', activeWallet: 'airtime' },
    updatedUser: { _id: '507f1f77bcf86cd799439011', airtimeBalance: 250 },
  });

  const user = await service.deposit('507f1f77bcf86cd799439011', 250);

  assert.equal(user.airtimeBalance, 250);
  assert.deepEqual(state.findByIdAndUpdateCalls[0].update, [
    { $set: { airtimeBalance: { $round: [{ $add: ['$airtimeBalance', 250] }, 2] } } },
  ]);
});

test('manual credit accepts airtimeBalance as a walletType alias', async () => {
  const { service, state } = loadService({
    existingUser: { _id: '507f1f77bcf86cd799439011', activeWallet: 'balance' },
    updatedUser: { _id: '507f1f77bcf86cd799439011', airtimeBalance: 100 },
  });

  await service.deposit('507f1f77bcf86cd799439011', 100, 'airtimeBalance');

  assert.deepEqual(state.findByIdAndUpdateCalls[0].update, [
    { $set: { airtimeBalance: { $round: [{ $add: ['$airtimeBalance', 100] }, 2] } } },
  ]);
});
