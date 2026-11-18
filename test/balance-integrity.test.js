'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const Transaction = require('../src/domains/transaction/transaction.model');
const { evaluate, assertBalanceBacked } = require('../src/domains/admin/balanceIntegrity.service');

const ledger = (values = {}) => {
  const map = (v) => new Map(v == null ? [] : [['u1', v]]);
  return {
    deposits: map(values.deposits),
    withdrawals: map(values.withdrawals),
    virtual: map(values.virtual),
    sportsbook: map(values.sportsbook),
    cashback: map(values.cashback),
    adjustments: map(values.adjustments),
  };
};
const user = (extra) => ({ _id: 'u1', phone: '254700000001', status: 'active', ...extra });

test('a wallet explained by deposits, play and withdrawals is clean', () => {
  const r = evaluate(user({ balance: 130 }), ledger({ deposits: 500, withdrawals: 300, virtual: -70 }));
  assert.equal(r.expected, 130);
  assert.equal(r.excess, 0);
  assert.equal(r.anomalous, false);
});

test('money with no deposit, win or recorded credit is flagged', () => {
  const r = evaluate(user({ balance: 589100 }), ledger({}));
  assert.equal(r.excess, 589100);
  assert.equal(r.anomalous, true);
});

test('a recorded staff credit explains the money', () => {
  const r = evaluate(user({ balance: 1000 }), ledger({ adjustments: 1000 }));
  assert.equal(r.anomalous, false);
});

test('bonus balance is part of the main balance, not extra money', () => {
  const r = evaluate(user({ balance: 20, bonusBalance: 20, welcomeBonus: { grantedAt: new Date(), amount: 20 } }), ledger({}));
  assert.equal(r.excess, 0);
});

test('a few cents of rounding are tolerated', () => {
  const r = evaluate(user({ balance: 100.4 }), ledger({ deposits: 100 }));
  assert.equal(r.anomalous, false);
});

test('a player who never deposited cannot withdraw, whatever the balance', async () => {
  const saved = { ...config.balanceIntegrity };
  const originalExists = Transaction.exists;
  Object.assign(config.balanceIntegrity, { requireDepositBeforeWithdrawal: true, enforceOnWithdrawal: false });
  try {
    let query;
    Transaction.exists = async (q) => { query = q; return null; };
    await assert.rejects(assertBalanceBacked({ _id: 'u1' }), /deposit before your first withdrawal/);
    assert.equal(query.type, 'deposit');
    assert.equal(query.status, 'completed');
    assert.deepEqual(query.provider, { $nin: ['test-credit'] });

    Transaction.exists = async () => ({ _id: 'd1' });
    await assertBalanceBacked({ _id: 'u1' });
  } finally {
    Transaction.exists = originalExists;
    Object.assign(config.balanceIntegrity, saved);
  }
});

test('a flagged account pauses withdrawals, alerts the dashboard and SMSes the super admins once', async () => {
  const Module = require('node:module');
  const servicePath = require.resolve('../src/domains/admin/balanceIntegrity.service');
  const state = { updates: [], notifications: [], sms: [], dedupe: false };
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../user/user.model') return { updateOne: async (q, u) => { state.updates.push({ q, u }); } };
      if (request === '../notification/notification.service') {
        return { create: async (n) => { state.notifications.push(n); return state.dedupe ? null : n; } };
      }
      if (request === '../../services/sms.service') return { safeSend: async (m) => { state.sms.push(m); return { sent: true }; } };
      if (request === '../../config') return { balanceIntegrity: { alertPhones: ['0714073826', '0700000000'], toleranceKes: 1 } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  const service = require(servicePath);
  Module._load = originalLoad;
  delete require.cache[servicePath];

  const flagged = { userId: 'u1', phone: '254711994821', actual: 589100, expected: 0, excess: 589100 };
  await service.flagAndPause(flagged, { reason: 'test' });
  assert.deepEqual(state.updates[0].u, { $set: { withdrawalPaused: true } });
  assert.equal(state.notifications[0].severity, 'critical');
  assert.equal(state.sms.length, 2);
  assert.match(state.sms[0].message, /254711994821.*589100/);

  state.dedupe = true;
  await service.flagAndPause(flagged, { reason: 'again' });
  assert.equal(state.sms.length, 2); // no repeat SMS inside the alert window
});

test('an approved review explains the reviewed amount', () => {
  // An integrity_review adjustment counts at its amount; the balance itself is unchanged.
  const r = evaluate(user({ balance: 338.53, referralStats: { bonusEarned: 40 } }), ledger({ deposits: 1544, withdrawals: 2737, virtual: -2355.32, cashback: 7.8, adjustments: 3839.05 }));
  assert.equal(r.anomalous, false);
});
