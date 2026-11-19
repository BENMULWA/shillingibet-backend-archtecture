'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { computeWithdrawalCharges, payoutAmountOf, sameAmount, matchesPayout } = require('../src/domains/transaction/withdrawalCharges');

const withCharges = (taxRate, fee, fn, feeMinAmount = 0) => {
  const saved = { ...config.withdrawal };
  Object.assign(config.withdrawal, { taxRate, fee, feeMinAmount });
  try { return fn(); } finally { Object.assign(config.withdrawal, saved); }
};

test('5% tax and no fee: KES 150 pays out a whole KES 142 (M-Pesa pays whole shillings)', () => {
  withCharges(0.05, 0, () => {
    assert.deepEqual(computeWithdrawalCharges(150), { amount: 150, taxRate: 0.05, taxAmount: 7.5, feeAmount: 0, roundingAmount: 0.5, netAmount: 142 });
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

test('tax stays exact to the cent; the payout is rounded down to whole shillings', () => {
  withCharges(0.05, 0, () => {
    const c = computeWithdrawalCharges(101.11);
    assert.equal(c.taxAmount, 5.06);
    assert.equal(c.netAmount, 96);
    assert.equal(c.roundingAmount, 0.05);
    // every shilling is accounted for: wallet debit = payout + tax + fee + rounding
    assert.equal(Math.round((c.netAmount + c.taxAmount + c.feeAmount + c.roundingAmount) * 100) / 100, c.amount);
  });
});

test('below the fee threshold only tax is taken; from the threshold the fee is added', () => {
  withCharges(0.05, 10, () => {
    assert.deepEqual(computeWithdrawalCharges(100), { amount: 100, taxRate: 0.05, taxAmount: 5, feeAmount: 0, roundingAmount: 0, netAmount: 95 });
    assert.deepEqual(computeWithdrawalCharges(149.99), { amount: 149.99, taxRate: 0.05, taxAmount: 7.5, feeAmount: 0, roundingAmount: 0.49, netAmount: 142 });
    assert.deepEqual(computeWithdrawalCharges(150), { amount: 150, taxRate: 0.05, taxAmount: 7.5, feeAmount: 10, roundingAmount: 0.5, netAmount: 132 });
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

test('a callback paying whole shillings matches an older withdrawal that asked for cents', () => {
  const legacy = { type: 'withdrawal', amount: 150, netAmount: 142.5 };
  assert.ok(matchesPayout(142, legacy));      // M-Pesa paid 142 for a 142.50 request
  assert.ok(matchesPayout(142.5, legacy));
  assert.ok(!matchesPayout(141, legacy));
  assert.ok(!matchesPayout(150, legacy));
  assert.ok(matchesPayout(142, { type: 'withdrawal', amount: 150, netAmount: 142 }));
  assert.ok(!matchesPayout(99, { type: 'deposit', amount: 100 }));
});
