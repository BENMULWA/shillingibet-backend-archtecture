'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/admin/liquidityAlert.service');

const load = ({ kesBalance, claimable = true, balanceError }) => {
  const originalLoad = Module._load;
  const state = { sms: [], notifications: [], claims: 0 };
  const mocks = {
    '../../config': () => ({
      liquidity: { alertPhones: ['0714073826'], threshold: 500, cooldownMinutes: 60, checkMinutes: 5, monitorEnabled: true },
    }),
    '../../utils/logger': () => ({ info() {}, warn() {}, error() {} }),
    '../../integrations/mamlaka/mamlaka.client': () => ({
      getPayoutBalance: async () => {
        if (balanceError) throw balanceError;
        return { Balances: { kesBalance, totalBalance: kesBalance } };
      },
    }),
    '../../services/sms.service': () => ({
      safeSend: async (payload) => { state.sms.push(payload); },
    }),
    '../notification/notification.service': () => ({
      create: async (n) => { state.notifications.push(n); },
    }),
    './payoutFloat.model': () => ({
      updateOne: () => Promise.resolve({}),
      findOneAndUpdate: () => {
        state.claims += 1;
        const claimed = claimable && state.claims === 1;
        return { lean: async () => (claimed ? { _id: 'payout-float' } : null) };
      },
    }),
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

test('a balance below the threshold texts the super admin once and raises a notification', async () => {
  const { service, state } = load({ kesBalance: 169 });
  const first = await service.checkLiquidity({ force: true });
  assert.equal(first.low, true);
  assert.equal(first.alerted, true);
  assert.equal(state.sms.length, 1);
  assert.equal(state.sms[0].phone, '0714073826');
  assert.match(state.sms[0].message, /KES 169/);
  assert.match(state.sms[0].message, /KES 500/);
  assert.equal(state.notifications[0].severity, 'critical');

  // Still low on the next check, but inside the cooldown: no second SMS.
  const second = await service.checkLiquidity({ force: true });
  assert.equal(second.low, true);
  assert.equal(second.alerted, false);
  assert.equal(state.sms.length, 1);
});

test('a healthy balance sends nothing', async () => {
  const { service, state } = load({ kesBalance: 2500 });
  const result = await service.checkLiquidity({ force: true });
  assert.equal(result.low, false);
  assert.equal(state.sms.length, 0);
});

test('exactly at the threshold is not an alert', async () => {
  const { service, state } = load({ kesBalance: 500 });
  const result = await service.checkLiquidity({ force: true });
  assert.equal(result.low, false);
  assert.equal(state.sms.length, 0);
});

test('a provider outage does not crash or alert', async () => {
  const { service, state } = load({ balanceError: new Error('timeout') });
  const result = await service.checkLiquidity({ force: true });
  assert.equal(result.checked, false);
  assert.equal(state.sms.length, 0);
});
