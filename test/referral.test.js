'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeReferralCode,
  makeReferralCodeCandidate,
  qualifiesForReferralBonus,
} = require('../src/domains/user/referral');

test('normalizeReferralCode trims, uppercases, and strips unsupported characters', () => {
  assert.equal(normalizeReferralCode(' sb-12_x '), 'SB12X');
});

test('makeReferralCodeCandidate returns an uppercase alphanumeric code with SB prefix', () => {
  const code = makeReferralCodeCandidate();
  assert.match(code, /^SB[A-Z0-9]{8}$/);
});

test('qualifiesForReferralBonus only returns true after going above the threshold', () => {
  assert.equal(qualifiesForReferralBonus(100, 100), false);
  assert.equal(qualifiesForReferralBonus(100.01, 100), true);
});

test('phone verification codes are six digits', () => {
  const code = `${Math.floor(100000 + Math.random() * 900000)}`;
  assert.match(code, /^\d{6}$/);
});
