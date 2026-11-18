'use strict';

const config = require('../../config');
const ApiError = require('../../utils/ApiError');

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// Charges taken from a cash (KES) withdrawal. The player's wallet is debited the full
// `amount`; the payout provider is sent `netAmount`; `taxAmount` and `feeAmount` stay with
// the platform and are reported on the dashboard. Airtime withdrawals carry no charges.
// Tax applies to every withdrawal; the flat fee only from `feeMinAmount` upwards.
const computeWithdrawalCharges = (amount) => {
  const gross = round2(amount);
  const { taxRate, fee, feeMinAmount } = config.withdrawal;
  const taxAmount = round2(gross * taxRate);
  const feeAmount = gross >= feeMinAmount ? round2(fee) : 0;
  const netAmount = round2(gross - taxAmount - feeAmount);
  if (netAmount <= 0) {
    throw ApiError.badRequest('Withdrawal amount is too small to cover tax and fees');
  }
  return { amount: gross, taxRate, taxAmount, feeAmount, netAmount };
};

// What the provider was actually asked to pay. Older withdrawals have no netAmount.
const payoutAmountOf = (txn) =>
  txn?.type === 'withdrawal' && txn.netAmount != null ? txn.netAmount : txn?.amount;

const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// Published to the betting site so its "You will receive" matches what is paid out.
const withdrawalChargeRules = () => ({
  taxRate: config.withdrawal.taxRate,
  fee: config.withdrawal.fee,
  feeMinAmount: config.withdrawal.feeMinAmount,
  currency: 'KES',
  appliesTo: ['mpesa', 'comet'],
});

module.exports = { computeWithdrawalCharges, withdrawalChargeRules, payoutAmountOf, sameAmount, round2 };
