'use strict';

// Balance integrity: every shilling in a player's wallet must be explained by a record.
//
//   expected = completed deposits
//            − withdrawals (completed or pending; failed ones were refunded)
//            + virtual game movements (stakes, wins, refunds)
//            + sportsbook results (−stake, +payout if won, +stake if void)
//            + cashback + referral earnings + welcome bonus
//            + recorded staff adjustments (credits, balances zeroed)
//   excess   = actual (main + airtime wallets) − expected
//
// excess > 0 means money appeared without a deposit, win, bonus or recorded credit:
// a direct database edit or an unrecorded credit. Such accounts must not withdraw.
// (bonusBalance is the locked part of `balance`, not extra money, so it is not added.)

const mongoose = require('mongoose');
const config = require('../../config');
const logger = require('../../utils/logger');
const User = require('../user/user.model');
const Transaction = require('../transaction/transaction.model');
const VirtualTxn = require('../virtual/virtualTxn.model');
const Bet = require('../bet/bet.model');
const CashbackAward = require('../cashback/cashbackAward.model');
const BalanceAdjustment = require('./balanceAdjustment.model');
const notificationService = require('../notification/notification.service');
const smsService = require('../../services/sms.service');

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(num(n) * 100) / 100;

// Tolerance for rounding: KES 1, or 0.5% of the balance for large wallets.
const tolerance = (actual) => Math.max(config.balanceIntegrity.toleranceKes, Math.abs(actual) * 0.005);

const sumByUser = async (Model, match, valueExpr) => {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: '$user', v: { $sum: valueExpr } } }]);
  return new Map(rows.map((r) => [String(r._id), num(r.v)]));
};

const ledgerFor = async (userMatch) => {
  const ids = userMatch.ids;
  const scope = ids ? { user: { $in: ids } } : {};
  const [deposits, withdrawals, virtual, sportsbook, cashback, adjustments] = await Promise.all([
    sumByUser(Transaction, { ...scope, type: 'deposit', status: 'completed' }, '$amount'),
    sumByUser(Transaction, { ...scope, type: 'withdrawal', status: { $in: ['completed', 'pending'] } }, '$amount'),
    sumByUser(VirtualTxn, scope, '$delta'),
    sumByUser(Bet, scope, {
      $add: [
        { $multiply: ['$stake', -1] },
        { $cond: [{ $eq: ['$status', 'won'] }, '$potentialPayout', 0] },
        { $cond: [{ $eq: ['$status', 'void'] }, '$stake', 0] },
      ],
    }),
    sumByUser(CashbackAward, scope, '$amount'),
    sumByUser(BalanceAdjustment, scope, { $subtract: ['$balanceAfter', '$balanceBefore'] }),
  ]);
  return { deposits, withdrawals, virtual, sportsbook, cashback, adjustments };
};

const evaluate = (user, ledger) => {
  const id = String(user._id);
  const actual = round2(num(user.balance) + num(user.airtimeBalance));
  const welcome = user.welcomeBonus?.grantedAt ? num(user.welcomeBonus.amount) : 0;
  const parts = {
    deposits: ledger.deposits.get(id) || 0,
    withdrawals: -(ledger.withdrawals.get(id) || 0),
    virtualGames: ledger.virtual.get(id) || 0,
    sportsbook: ledger.sportsbook.get(id) || 0,
    cashback: ledger.cashback.get(id) || 0,
    referral: num(user.referralStats?.bonusEarned),
    welcomeBonus: welcome,
    staffAdjustments: ledger.adjustments.get(id) || 0,
  };
  const expected = round2(Object.values(parts).reduce((a, b) => a + b, 0));
  const excess = round2(actual - expected);
  return {
    userId: id,
    phone: user.phone,
    name: user.name || null,
    status: user.status,
    withdrawalPaused: Boolean(user.withdrawalPaused),
    actual,
    expected,
    excess,
    anomalous: excess > tolerance(actual),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round2(v)])),
  };
};

const USER_FIELDS = 'phone name status balance airtimeBalance referralStats welcomeBonus withdrawalPaused';

// One player, used before every withdrawal.
const checkUser = async (userId) => {
  const user = await User.findById(userId).select(USER_FIELDS).lean();
  if (!user) return null;
  const ledger = await ledgerFor({ ids: [new mongoose.Types.ObjectId(String(userId))] });
  return evaluate(user, ledger);
};

// Every player. Returns anomalies sorted by excess, largest first.
const scanAll = async () => {
  const users = await User.find({ deletedAt: null }).select(USER_FIELDS).lean();
  const ledger = await ledgerFor({});
  const results = users.map((u) => evaluate(u, ledger));
  return {
    checked: results.length,
    anomalies: results.filter((r) => r.anomalous).sort((a, b) => b.excess - a.excess),
    shortfalls: results.filter((r) => r.excess < -tolerance(r.actual)).length,
  };
};

// Stops withdrawals for an account whose balance is not backed by its history,
// and tells staff. The money stays in the wallet until a super admin reviews it.
const flagAndPause = async (result, { reason }) => {
  await User.updateOne({ _id: result.userId }, { $set: { withdrawalPaused: true } });
  const notification = await notificationService.create({
    type: 'fraud_alert',
    severity: 'critical',
    title: 'Unbacked balance: withdrawals paused',
    message: `${result.phone} holds KES ${result.actual} but deposits, play and recorded credits explain only KES ${result.expected} (KES ${result.excess} unexplained). ${reason}`,
    relatedId: result.userId,
    dedupeKey: `unbacked-balance:${result.userId}`,
  });
  // SMS the super admins too, once per account per alert window (the dashboard
  // notification is deduplicated, so no SMS is sent when it was).
  if (notification) {
    const sms = `Bingwake ALERT: account ${result.phone} has KES ${result.excess} not backed by deposits or play. Withdrawals paused. Review in the dashboard.`;
    await Promise.all(
      config.balanceIntegrity.alertPhones.map((phone) => smsService.safeSend({ phone, message: sms, context: 'fraud_unbacked_balance' }))
    );
  }
  logger.warn('Unbacked balance flagged', result.phone, result.actual, result.expected, result.excess, reason);
};

// Deposits made through a real payment channel. Test credits never count.
const NOT_REAL_DEPOSIT_PROVIDERS = ['test-credit'];
const hasRealDeposit = async (userId) =>
  Boolean(
    await Transaction.exists({
      user: userId,
      type: 'deposit',
      status: 'completed',
      provider: { $nin: NOT_REAL_DEPOSIT_PROVIDERS },
    })
  );

// Called inside every withdrawal (M-Pesa, Comet, Celo, airtime) before any money moves:
// 1. the player must have made at least one real deposit;
// 2. the balance must be explained by their history.
const assertBalanceBacked = async (user) => {
  if (config.balanceIntegrity.requireDepositBeforeWithdrawal && !(await hasRealDeposit(user._id))) {
    const ApiError = require('../../utils/ApiError');
    throw ApiError.forbidden('Please make a deposit before your first withdrawal.');
  }
  if (!config.balanceIntegrity.enforceOnWithdrawal) return;
  const result = await checkUser(user._id);
  if (!result?.anomalous) return;
  await flagAndPause(result, { reason: 'Blocked at withdrawal.' });
  const ApiError = require('../../utils/ApiError');
  throw ApiError.forbidden('Withdrawals are on hold for this account while it is reviewed. Please contact support.');
};

let timer;
const runScan = async () => {
  const { checked, anomalies } = await scanAll();
  for (const a of anomalies) {
    if (!a.withdrawalPaused) await flagAndPause(a, { reason: 'Found by the hourly balance check.' });
  }
  logger.info(`Balance integrity scan: ${checked} wallets, ${anomalies.length} unbacked`);
  return { checked, anomalies: anomalies.length };
};

const startBalanceIntegrityScanner = () => {
  if (!config.balanceIntegrity.scanEnabled || timer) return;
  const run = () => runScan().catch((error) => logger.warn('Balance integrity scan failed', error.message));
  setTimeout(run, 60 * 1000).unref();
  timer = setInterval(run, config.balanceIntegrity.scanMinutes * 60 * 1000);
  timer.unref();
};

module.exports = { hasRealDeposit, checkUser, scanAll, runScan, assertBalanceBacked, flagAndPause, evaluate, startBalanceIntegrityScanner };
