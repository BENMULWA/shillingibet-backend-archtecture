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
    adjustments: [],
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

    if (request === '../admin/balanceAdjustment.model' && parent?.filename === servicePath) {
      return { create: async (doc) => { state.adjustments.push(doc); return doc; } };
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
      request === './referral' ||
      request === '../admin/staffRole.service'
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

const STAFF = { _id: '507f1f77bcf86cd799439099' };

test('manual credit uses the target user activeWallet when walletType is omitted', async () => {
  const { service, state } = loadService({
    existingUser: { _id: '507f1f77bcf86cd799439011', activeWallet: 'airtime' },
    updatedUser: { _id: '507f1f77bcf86cd799439011', airtimeBalance: 0 },
  });

  const user = await service.deposit('507f1f77bcf86cd799439011', 250, undefined, { actor: STAFF });

  assert.equal(user.airtimeBalance, 250);
  assert.equal(state.adjustments.length, 1);
  assert.equal(state.adjustments[0].type, 'admin_credit');
  assert.equal(state.adjustments[0].amount, 250);
  assert.equal(state.adjustments[0].balanceBefore, 0);
  assert.equal(state.adjustments[0].balanceAfter, 250);
  assert.equal(state.adjustments[0].actor, STAFF._id);
  assert.deepEqual(state.findByIdAndUpdateCalls[0].update, [
    { $set: { airtimeBalance: { $round: [{ $add: ['$airtimeBalance', 250] }, 2] } } },
  ]);
});

test('manual credit accepts airtimeBalance as a walletType alias', async () => {
  const { service, state } = loadService({
    existingUser: { _id: '507f1f77bcf86cd799439011', activeWallet: 'balance' },
    updatedUser: { _id: '507f1f77bcf86cd799439011', airtimeBalance: 100 },
  });

  await service.deposit('507f1f77bcf86cd799439011', 100, 'airtimeBalance', { actor: STAFF });

  assert.deepEqual(state.findByIdAndUpdateCalls[0].update, [
    { $set: { airtimeBalance: { $round: [{ $add: ['$airtimeBalance', 100] }, 2] } } },
  ]);
});

test('manual credit refuses to run without a staff member to record', async () => {
  const { service, state } = loadService({
    existingUser: { _id: '507f1f77bcf86cd799439011', activeWallet: 'balance' },
    updatedUser: { _id: '507f1f77bcf86cd799439011', balance: 0 },
  });

  await assert.rejects(service.deposit('507f1f77bcf86cd799439011', 100), /staff member/);
  assert.equal(state.findByIdAndUpdateCalls.length, 0);
});
