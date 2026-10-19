'use strict';

const crypto = require('crypto');

const normalizeReferralCode = (code) =>
  String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const makeReferralCodeCandidate = (prefix = 'SB') => {
  const random = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${normalizeReferralCode(prefix).slice(0, 4) || 'SB'}${random.slice(0, 8)}`;
};

const qualifiesForReferralBonus = (completedDepositTotal, threshold) =>
  Number(completedDepositTotal) > Number(threshold);

module.exports = { normalizeReferralCode, makeReferralCodeCandidate, qualifiesForReferralBonus };
