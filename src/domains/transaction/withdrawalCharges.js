'use strict';

const config = require('../../config');
const ApiError = require('../../utils/ApiError');

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// Charges taken from a cash (KES) withdrawal. The player's wallet is debited the full
// `amount`; the payout provider is sent `netAmount`; `taxAmount` and `feeAmount` stay with
// the platform and are reported on the dashboard. Airtime withdrawals carry no charges.
// Tax applies to every withdrawal; the flat fee only from `feeMinAmount` upwards.
// M-Pesa pays whole shillings only, so the payout is rounded DOWN to a whole shilling;
// the cents left over (`roundingAmount`, always < 1) stay with the platform. Tax stays exact.
const computeWithdrawalCharges = (amount) => {
  const gross = round2(amount);
  const { taxRate, fee, feeMinAmount } = config.withdrawal;
  const taxAmount = round2(gross * taxRate);
  const feeAmount = gross >= feeMinAmount ? round2(fee) : 0;
  const exactNet = round2(gross - taxAmount - feeAmount);
  const netAmount = Math.floor(exactNet + 1e-9);
  const roundingAmount = round2(exactNet - netAmount);
  if (netAmount <= 0) {
    throw ApiError.badRequest('Withdrawal amount is too small to cover tax and fees');
  }
  return { amount: gross, taxRate, taxAmount, feeAmount, roundingAmount, netAmount };
};

// What the provider was actually asked to pay. Older withdrawals have no netAmount.
const payoutAmountOf = (txn) =>
  txn?.type === 'withdrawal' && txn.netAmount != null ? txn.netAmount : txn?.amount;

const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// Does a provider's reported payout match what we asked for? Withdrawals created before
// whole-shilling rounding asked for cents (e.g. 142.50); M-Pesa pays and reports 142.
const matchesPayout = (reported, txn) => {
  const expected = payoutAmountOf(txn);
  if (sameAmount(reported, expected)) return true;
  return txn?.type === 'withdrawal' && sameAmount(reported, Math.floor(Number(expected) + 1e-9));
};

// Published to the betting site so its "You will receive" matches what is paid out.
const withdrawalChargeRules = () => ({
  taxRate: config.withdrawal.taxRate,
  fee: config.withdrawal.fee,
  feeMinAmount: config.withdrawal.feeMinAmount,
  currency: 'KES',
  appliesTo: ['mpesa', 'comet'],
});

module.exports = { computeWithdrawalCharges, withdrawalChargeRules, payoutAmountOf, sameAmount, matchesPayout, round2 };
