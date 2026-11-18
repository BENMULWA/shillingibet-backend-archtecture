'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveRow, listDays, resolveRange } = require('../src/domains/admin/finance.service');

const base = {
  deposits: 1000, withdrawalsPaidOut: 380, withdrawalTax: 20, withdrawalFees: 10,
  virtualStakes: 500, virtualPayouts: 300, virtualRefunds: 20,
  sportsbookStakes: 100, sportsbookPayouts: 150, sportsbookRefunds: 0,
  welcomeBonuses: 20, referralBonuses: 10, cashback: 5,
};

test('GGR covers virtual games and sportsbook; tax is not revenue but fees are', () => {
  const row = deriveRow(base);
  assert.equal(row.virtualGgr, 180);
  assert.equal(row.sportsbookGgr, -50);
  assert.equal(row.ggr, 130);
  assert.equal(row.bonusCost, 35);
  assert.equal(row.netRevenue, 105); // 130 - 35 + 10 fee; the 20 tax is owed to KRA
  assert.equal(row.netCashFlow, 620);
});

test('days are listed in Nairobi time, inclusive', () => {
  const { start, end } = resolveRange({ dateFrom: '2026-11-16T00:00:00+03:00', dateTo: '2026-11-18T23:59:59+03:00' });
  assert.deepEqual(listDays(start, end), ['2026-11-16', '2026-11-17', '2026-11-18']);
});

test('ranges must be in order and at most a year', () => {
  assert.throws(() => resolveRange({ dateFrom: '2026-11-18', dateTo: '2026-11-01' }));
  assert.throws(() => resolveRange({ dateFrom: '2024-01-01', dateTo: '2026-01-01' }));
});
