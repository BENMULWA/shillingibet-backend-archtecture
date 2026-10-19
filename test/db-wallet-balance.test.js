'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { incWalletBalance } = require('../src/utils/db');

test('wallet increments treat a null legacy airtime balance as zero', () => {
  assert.deepEqual(incWalletBalance('airtime', 10), [
    {
      $set: {
        airtimeBalance: {
          $round: [{ $add: [{ $ifNull: ['$airtimeBalance', 0] }, 10] }, 2],
        },
      },
    },
  ]);
});
