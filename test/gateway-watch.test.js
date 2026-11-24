'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeMovements, unexplainedChange, worstBreach } = require('../src/domains/admin/gatewayWatch.service');

const cfg = { feePerTxnKes: 35, feeRate: 0.03 };
const reading = (payinKes, payoutKes) => ({ payinKes, payoutKes });
const none = summarizeMovements([], cfg);

test('our own deposits and payouts explain the change', () => {
  const m = summarizeMovements(
    [
      { type: 'deposit', amount: 500 },
      { type: 'withdrawal', amount: 150, netAmount: 132.5 }, // Mamlaka pays whole shillings: 132
    ],
    cfg
  );
  assert.equal(m.deposits, 500);
  assert.equal(m.payouts, 132);
  assert.equal(m.expectedChange, 368);
  const r = unexplainedChange(reading(1000, 2000), reading(1500, 1868), m);
  assert.equal(r.unexplained, 0);
});

test('provider charges on our own transactions are not flagged', () => {
  const m = summarizeMovements([{ type: 'withdrawal', amount: 1000, netAmount: 940 }], cfg);
  // Paid 940 plus a KES 20 charge.
  const r = unexplainedChange(reading(0, 5000), reading(0, 4040), m);
  assert.equal(r.unexplained, 0);
});

test('moving money from pay-in to payout is not flagged', () => {
  const r = unexplainedChange(reading(50000, 900), reading(0, 50900), none);
  assert.equal(r.unexplained, 0);
});

test('a payout Bingwake did not send is flagged in full', () => {
  // 20 Nov 2026, 16:40: KES 49,000 paid to an unknown number.
  const r = unexplainedChange(reading(0, 49862), reading(0, 862), none);
  assert.equal(r.unexplained, -49000);
  const breach = worstBreach([{ minutes: 10, threshold: 100, unexplained: r.unexplained }]);
  assert.equal(breach.loss, 49000);
});

test('the first small theft payouts already cross the 10-minute threshold', () => {
  // 15:45 KES 50 and 15:46 KES 77 left with no Bingwake record.
  const r = unexplainedChange(reading(50622, 925), reading(50622, 798), none);
  assert.equal(r.unexplained, -127);
  assert.ok(worstBreach([{ minutes: 10, threshold: 100, unexplained: r.unexplained }]));
});

test('money our pending withdrawals could explain does not alert yet', () => {
  const r = unexplainedChange(reading(0, 5000), reading(0, 4000), none);
  assert.equal(worstBreach([{ minutes: 10, threshold: 100, unexplained: r.unexplained }], 1000), null);
});

test('unexplained money coming in (a top-up) never alerts', () => {
  const r = unexplainedChange(reading(0, 100), reading(0, 10100), none);
  assert.equal(r.unexplained, 10000);
  assert.equal(worstBreach([{ minutes: 10, threshold: 100, unexplained: r.unexplained }]), null);
});

test('the hourly window catches a slow drain the short window misses', () => {
  const windows = [
    { minutes: 10, threshold: 100, unexplained: -60 },
    { minutes: 60, threshold: 300, unexplained: -360 },
  ];
  const breach = worstBreach(windows);
  assert.equal(breach.minutes, 60);
  assert.equal(breach.loss, 360);
});
