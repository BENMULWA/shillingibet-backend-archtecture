
//ANOMALY DETECTION SCRIPT: FOR USER BALANCE AND ANOMALLY DETECTION

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
    // A super-admin balance review doesn't move money; it records that the reviewed
    // amount is legitimate, so it counts as explained (its `amount`).
    sumByUser(BalanceAdjustment, scope, {
      $cond: [
        { $eq: ['$type', 'integrity_review'] },
        '$amount',
        { $subtract: ['$balanceAfter', '$balanceBefore'] },
      ],
    }),
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
// 0. the player's phone number must be verified;
// 1. the player must have made at least one real deposit;
// 2. the balance must be explained by their history.
const assertBalanceBacked = async (user) => {
  // 0. Identity first: only players who verified their phone number can withdraw.
  //    Read fresh from the database, never from the copy attached to the request.
  const account = await User.findById(user._id).select('phoneVerified').lean();
  if (account?.phoneVerified !== true) {
    const ApiError = require('../../utils/ApiError');
    throw ApiError.forbidden('Please verify your phone number if it was not verified during registration.');
  }
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

// Super admin confirms an account's unexplained balance is legitimate (e.g. old test or
// staff credits that were never recorded). Records the approved amount in the ledger so
// the check passes from now on, lifts the withdrawal pause, and tells the alert phones.
// Every approval is permanent and audited; it never changes the balance itself.
const approveBalance = async ({ actor, userId, reason }) => {
  const ApiError = require('../../utils/ApiError');
  const before = await checkUser(userId);
  if (!before) throw ApiError.notFound('Player not found');

  let adjustment = null;
  if (before.excess > 0) {
    const current = await User.findById(userId).select('balance bonusBalance').lean();
    adjustment = await BalanceAdjustment.create({
      type: 'integrity_review',
      user: userId,
      actor: actor._id,
      amount: before.excess,
      balanceBefore: num(current.balance),
      balanceAfter: num(current.balance),
      bonusBalanceBefore: num(current.bonusBalance),
      bonusBalanceAfter: num(current.bonusBalance),
      reason,
    });
  }
  await User.updateOne({ _id: userId }, { $set: { withdrawalPaused: false } });

  const sms = `Bingwake: ${actor.phone} approved KES ${before.excess} on account ${before.phone} and re-enabled withdrawals. Reason: ${reason}`.slice(0, 300);
  await Promise.all(
    config.balanceIntegrity.alertPhones.map((phone) => smsService.safeSend({ phone, message: sms, context: 'fraud_balance_approved' }))
  );
  logger.warn('Balance approved by super admin', actor.phone, before.phone, before.excess, reason);

  return { before, after: await checkUser(userId), adjustmentId: adjustment?._id || null };
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

module.exports = { approveBalance, hasRealDeposit, checkUser, scanAll, runScan, assertBalanceBacked, flagAndPause, evaluate, startBalanceIntegrityScanner };

// =============================================================================================
// SUMMARY FOR CODE REVIEW AND AUDIT
// =============================================================================================
//
// 1. PURPOSE: stop money that was never paid in or won from leaving the platform. Every shilling
//    in a wallet must be explained by a record the app itself writes.
//
// 2. WHAT IT FLAGS: balances raised directly in the database (Atlas / Compass) or credited
//    outside the recorded paths, with no deposit, game result, bonus or staff adjustment behind it.
//
// 3. THE RULE: excess = actual balance (main + airtime) - balance explained by history.
//    Flagged when excess > KES 1 (BALANCE_INTEGRITY_TOLERANCE_KES) or > 0.5% of the balance.
//
// 4. WHAT COUNTS AS EXPLAINED (ledgerFor / evaluate):
//    + completed deposits (transactions)       - completed and pending withdrawals (transactions)
//    + virtual game deltas (virtualtxns)       + sportsbook results (bets: -stake, +payout, +void)
//    + cashback (cashbackawards)               + referral earnings and welcome bonus (user fields)
//    + staff credits, zeroed balances and super-admin reviews (balanceadjustments)
//
// 5. SHORTFALLS (balance lower than history) are counted but never blocked: no money can leave.
//
// 6. WITHDRAWAL CHECKS (assertBalanceBacked), run before ANY money moves on M-Pesa, airtime,
//    Comet and Celo, in this order:
//    6.1 Phone number verified (read fresh from the database)
//        -> 403 "Please verify your phone number if it was not verified during registration."
//    6.2 At least one real completed deposit (REQUIRE_DEPOSIT_BEFORE_WITHDRAWAL)
//        -> 403 "Please make a deposit before your first withdrawal."
//    6.3 Balance explained by history (BALANCE_INTEGRITY_ENFORCE)
//        -> 403 "Withdrawals are on hold for this account while it is reviewed..."
//
// 7. ON A FLAG (flagAndPause): withdrawals paused on the account, a critical dashboard
//    notification ("Unbacked balance: withdrawals paused") and an SMS to FRAUD_ALERT_PHONES,
//    at most once per account every 30 minutes.
//
// 8. HOURLY SCAN (runScan / startBalanceIntegrityScanner): every BALANCE_INTEGRITY_SCAN_MINUTES
//    (default 60), production only. Flags and pauses new unbacked wallets; skips paused ones.
//
// 9. WHAT IT NEVER DOES: change a balance, or suspend an account. Players can still log in and
//    bet; only withdrawals stop. Zeroing a balance is a separate, recorded staff action.
//
// 10. WHAT IT CANNOT CATCH: fake DEPOSIT records. The paybill reconciliation on the Finance page
//     catches those, because they never appear on the Mamlaka statement.
//
// 11. CLEARING A FLAG (approveBalance): super admin only, reason of at least 10 characters.
//     Records an "integrity_review" adjustment for the excess (the balance itself is unchanged),
//     lifts the pause, sends an SMS, and is audited as "player.balance_approved"
//     (selfApproval: true when a super admin approves their own account).
//
// 12. WHERE TO FIND THE EVIDENCE:
//     - adminaudits: player.balance_approved, player.freeze_anomalous, withdrawal.cleanup
//     - balanceadjustments (cannot be edited): admin_credit, admin_zero_balance, integrity_review
//     - notifications: type fraud_alert, severity critical
//
// 13. ENDPOINTS:
//     - GET  /admin/fraud/balance-integrity       all anomalies          (fraud.view)
//     - GET  /admin/users/:id/balance-integrity   one player's check     (players.view or fraud.view)
//     - POST /admin/users/:id/balance-review      approve a balance      (super admin)
//
// 14. SETTINGS (.env):
//     BALANCE_INTEGRITY_ENFORCE=true         REQUIRE_DEPOSIT_BEFORE_WITHDRAWAL=true
//     BALANCE_INTEGRITY_TOLERANCE_KES=1      BALANCE_INTEGRITY_SCAN_MINUTES=60
//     BALANCE_INTEGRITY_SCAN_ENABLED=(default: on in production)   FRAUD_ALERT_PHONES=0714073826
// =============================================================================================
