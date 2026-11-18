'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toMovement } = require('../src/domains/admin/payoutFloatHistory.service');

test('an older allocation audit (request body only) becomes a movement', () => {
  const m = toMovement({ _id: 'a1', createdAt: new Date(), action: 'post_api_v1_admin_treasury_withdrawals_allocations', actorPhone: '2547', outcome: 'success', details: { body: { amount: 500, note: 'Dashboard treasury allocation' } } });
  assert.equal(m.type, 'allocation');
  assert.equal(m.amount, 500);
  assert.equal(m.note, 'Dashboard treasury allocation');
});

test('a new allocation keeps before, after and the Mamlaka balance', () => {
  const m = toMovement({ _id: 'a2', createdAt: new Date(), action: 'payout_float_allocation', actorPhone: '2547', outcome: 'success', changes: { amount: 1000, before: 0, after: 1000, mamlakaPayoutKes: 1149 } });
  assert.deepEqual([m.amount, m.floatBefore, m.floatAfter, m.mamlakaPayoutKes], [1000, 0, 1000, 1149]);
});

test('a reset shows the whole float leaving', () => {
  const m = toMovement({ _id: 'a3', createdAt: new Date(), action: 'payout_float_reset_flagged', actorPhone: '2547', outcome: 'success', reason: 'Flagged', changes: { before: { balance: 4988295 }, after: { balance: 0 } } });
  assert.equal(m.type, 'reset');
  assert.equal(m.amount, -4988295);
  assert.equal(m.floatAfter, 0);
});
