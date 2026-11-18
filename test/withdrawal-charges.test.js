'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { computeWithdrawalCharges, payoutAmountOf, sameAmount } = require('../src/domains/transaction/withdrawalCharges');

const withCharges = (taxRate, fee, fn, feeMinAmount = 0) => {
  const saved = { ...config.withdrawal };
  Object.assign(config.withdrawal, { taxRate, fee, feeMinAmount });
  try { return fn(); } finally { Object.assign(config.withdrawal, saved); }
};

test('5% tax and no fee: KES 150 pays out 142.50', () => {
  withCharges(0.05, 0, () => {
    assert.deepEqual(computeWithdrawalCharges(150), { amount: 150, taxRate: 0.05, taxAmount: 7.5, feeAmount: 0, netAmount: 142.5 });
  });
});

test('a flat fee is taken on top of the tax', () => {
  withCharges(0.05, 10, () => {
    const c = computeWithdrawalCharges(1000);
    assert.equal(c.taxAmount, 50);
    assert.equal(c.feeAmount, 10);
    assert.equal(c.netAmount, 940);
  });
});

test('amounts are rounded to cents', () => {
  withCharges(0.05, 0, () => {
    assert.equal(computeWithdrawalCharges(101.11).taxAmount, 5.06);
    assert.equal(computeWithdrawalCharges(101.11).netAmount, 96.05);
  });
});

test('below the fee threshold only tax is taken; from the threshold the fee is added', () => {
  withCharges(0.05, 10, () => {
    assert.deepEqual(computeWithdrawalCharges(100), { amount: 100, taxRate: 0.05, taxAmount: 5, feeAmount: 0, netAmount: 95 });
    assert.deepEqual(computeWithdrawalCharges(149.99), { amount: 149.99, taxRate: 0.05, taxAmount: 7.5, feeAmount: 0, netAmount: 142.49 });
    assert.deepEqual(computeWithdrawalCharges(150), { amount: 150, taxRate: 0.05, taxAmount: 7.5, feeAmount: 10, netAmount: 132.5 });
  }, 150);
});

test('a withdrawal that the charges would wipe out is refused', () => {
  withCharges(0.05, 100, () => {
    assert.throws(() => computeWithdrawalCharges(100), /too small/);
  });
});

test('callbacks are checked against the amount actually paid out', () => {
  assert.equal(payoutAmountOf({ type: 'withdrawal', amount: 150, netAmount: 142.5 }), 142.5);
  assert.equal(payoutAmountOf({ type: 'withdrawal', amount: 150, netAmount: null }), 150); // older withdrawals
  assert.equal(payoutAmountOf({ type: 'deposit', amount: 150, netAmount: null }), 150);
  assert.ok(sameAmount('142.50', 142.5));
  assert.ok(!sameAmount(150, 142.5));
});
