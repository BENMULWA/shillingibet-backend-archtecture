'use strict';

// Daily finance report for the back office: cash in and out, withdrawal tax (owed to KRA),
// withdrawal fees, gaming revenue from both the sportsbook and virtual games, bonus costs
// and net revenue. Days are calendar days in Nairobi time.

const ApiError = require('../../utils/ApiError');
const Transaction = require('../transaction/transaction.model');
const Bet = require('../bet/bet.model');
const VirtualTxn = require('../virtual/virtualTxn.model');
const CashbackAward = require('../cashback/cashbackAward.model');
const WelcomeBonusAward = require('../user/welcomeBonusAward.model');
const ReferralAward = require('../user/referralAward.model');
const BalanceAdjustment = require('./balanceAdjustment.model');
const User = require('../user/user.model');
const payoutFloatService = require('./payoutFloat.service');
const providerBalances = require('./providerBalance.service');

const TZ = 'Africa/Nairobi';
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // EAT is UTC+3 all year
const MAX_DAYS = 366;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayOf = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
const nairobiDay = (date) => new Date(date.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);

// Defaults to today in Nairobi. Returns [start, end] as UTC instants.
const resolveRange = ({ dateFrom, dateTo } = {}) => {
  const today = nairobiDay(new Date());
  const start = dateFrom ? new Date(dateFrom) : new Date(`${today}T00:00:00+03:00`);
  const end = dateTo ? new Date(dateTo) : new Date(`${today}T23:59:59.999+03:00`);
  if (start > end) throw ApiError.badRequest('dateFrom must be before dateTo');
  if ((end - start) / 864e5 > MAX_DAYS) throw ApiError.badRequest(`Choose a range of at most ${MAX_DAYS} days`);
  return { start, end };
};

const listDays = (start, end) => {
  const days = [];
  for (let d = nairobiDay(start); d <= nairobiDay(end);) {
    days.push(d);
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  }
  return days;
};

const ZERO = {
  depositsCount: 0,
  deposits: 0, // main (cash) wallet, KES
  airtimeDeposits: 0,
  withdrawalsCount: 0,
  withdrawalsDebited: 0, // taken from players' main wallets
  withdrawalsPaidOut: 0, // actually sent to M-Pesa / Comet
  withdrawalTax: 0, // owed to KRA
  withdrawalFees: 0, // platform revenue
  airtimeWithdrawals: 0,
  // By channel: only M-Pesa moves through the Mamlaka paybill; Comet, Fusion, Celo etc. do not.
  mpesaDeposits: 0,
  mpesaPaidOut: 0,
  cometPaidOut: 0,
  virtualBets: 0,
  virtualStakes: 0,
  virtualPayouts: 0,
  virtualRefunds: 0,
  sportsbookBets: 0,
  sportsbookStakes: 0,
  sportsbookPayouts: 0,
  sportsbookRefunds: 0,
  welcomeBonuses: 0,
  referralBonuses: 0,
  cashback: 0,
  manualCredits: 0,
  manualZeroed: 0,
};

const deriveRow = (row) => {
  const virtualGgr = row.virtualStakes - row.virtualPayouts - row.virtualRefunds;
  const sportsbookGgr = row.sportsbookStakes - row.sportsbookPayouts - row.sportsbookRefunds;
  const ggr = virtualGgr + sportsbookGgr;
  const bonusCost = row.welcomeBonuses + row.referralBonuses + row.cashback;
  const out = {
    ...row,
    virtualGgr,
    sportsbookGgr,
    ggr,
    bonusCost,
    // Gaming revenue after bonuses, plus withdrawal fees. Tax is excluded: it belongs to KRA.
    netRevenue: ggr - bonusCost + row.withdrawalFees,
    netCashFlow: row.deposits - row.withdrawalsPaidOut,
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]));
};

const getFinanceReport = async (query = {}) => {
  const { start, end } = resolveRange(query);
  const inRange = { $gte: start, $lte: end };
  const isAirtime = { $eq: ['$walletType', 'airtime'] };
  const isMpesa = { $in: [{ $toLower: { $ifNull: ['$provider', ''] } }, ['m-pesa', 'mpesa']] };
  const isComet = { $eq: [{ $toLower: { $ifNull: ['$provider', ''] } }, 'comet'] };
  const cash = (expr, when = true) => ({ $sum: { $cond: [{ $and: [{ $not: [isAirtime] }, when] }, expr, 0] } });

  const [deposits, withdrawals, virtual, betsPlaced, betsSettled, welcome, referral, cashback, adjustments] =
    await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'deposit', status: 'completed', currency: 'KES', completedAt: inRange } },
        {
          $group: {
            _id: dayOf('$completedAt'),
            depositsCount: { $sum: { $cond: [isAirtime, 0, 1] } },
            deposits: { $sum: { $cond: [isAirtime, 0, '$amount'] } },
            airtimeDeposits: { $sum: { $cond: [isAirtime, '$amount', 0] } },
            mpesaDeposits: cash('$amount', isMpesa),
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { type: 'withdrawal', status: 'completed', completedAt: inRange } },
        {
          $group: {
            _id: dayOf('$completedAt'),
            withdrawalsCount: { $sum: { $cond: [isAirtime, 0, 1] } },
            withdrawalsDebited: { $sum: { $cond: [isAirtime, 0, '$amount'] } },
            withdrawalsPaidOut: { $sum: { $cond: [isAirtime, 0, { $ifNull: ['$netAmount', '$amount'] }] } },
            withdrawalTax: { $sum: { $ifNull: ['$taxAmount', 0] } },
            withdrawalFees: { $sum: { $ifNull: ['$feeAmount', 0] } },
            airtimeWithdrawals: { $sum: { $cond: [isAirtime, '$amount', 0] } },
            mpesaPaidOut: cash({ $ifNull: ['$netAmount', '$amount'] }, isMpesa),
            cometPaidOut: cash({ $ifNull: ['$netAmount', '$amount'] }, isComet),
          },
        },
      ]),
      VirtualTxn.aggregate([
        { $match: { currency: 'KES', createdAt: inRange } },
        {
          $group: {
            _id: dayOf('$createdAt'),
            virtualBets: { $sum: { $cond: [{ $eq: ['$action', 'place_bet'] }, 1, 0] } },
            virtualStakes: { $sum: { $cond: [{ $eq: ['$action', 'place_bet'] }, '$amount', 0] } },
            virtualPayouts: {
              $sum: { $cond: [{ $in: ['$action', ['result_bet', 'result_freebet']] }, '$payout', 0] },
            },
            virtualRefunds: { $sum: { $cond: [{ $eq: ['$action', 'rollback_bet'] }, '$delta', 0] } },
          },
        },
      ]),
      Bet.aggregate([
        { $match: { createdAt: inRange } },
        { $group: { _id: dayOf('$createdAt'), sportsbookBets: { $sum: 1 }, sportsbookStakes: { $sum: '$stake' } } },
      ]),
      Bet.aggregate([
        { $match: { status: { $in: ['won', 'void'] }, settledAt: inRange } },
        {
          $group: {
            _id: dayOf('$settledAt'),
            sportsbookPayouts: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, '$potentialPayout', 0] } },
            sportsbookRefunds: { $sum: { $cond: [{ $eq: ['$status', 'void'] }, '$stake', 0] } },
          },
        },
      ]),
      WelcomeBonusAward.aggregate([
        { $match: { status: 'credited', creditedAt: inRange } },
        { $group: { _id: dayOf('$creditedAt'), welcomeBonuses: { $sum: '$amount' } } },
      ]),
      ReferralAward.aggregate([
        { $match: { status: 'credited', creditedAt: inRange } },
        { $group: { _id: dayOf('$creditedAt'), referralBonuses: { $sum: '$amount' } } },
      ]),
      CashbackAward.aggregate([
        { $match: { creditedAt: inRange } },
        { $group: { _id: dayOf('$creditedAt'), cashback: { $sum: '$amount' } } },
      ]),
      BalanceAdjustment.aggregate([
        { $match: { createdAt: inRange } },
        {
          $group: {
            _id: dayOf('$createdAt'),
            manualCredits: { $sum: { $cond: [{ $eq: ['$type', 'admin_credit'] }, '$amount', 0] } },
            manualZeroed: { $sum: { $cond: [{ $eq: ['$type', 'admin_zero_balance'] }, { $abs: '$amount' }, 0] } },
          },
        },
      ]),
    ]);

  const byDay = new Map(listDays(start, end).map((day) => [day, { date: day, ...ZERO }]));
  for (const rows of [deposits, withdrawals, virtual, betsPlaced, betsSettled, welcome, referral, cashback, adjustments]) {
    for (const { _id: day, ...values } of rows) {
      const row = byDay.get(day) || { date: day, ...ZERO };
      for (const [key, value] of Object.entries(values)) row[key] += Number(value) || 0;
      byDay.set(day, row);
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map(deriveRow);
  const totals = deriveRow(
    days.reduce((acc, row) => {
      for (const key of Object.keys(ZERO)) acc[key] += row[key];
      return acc;
    }, { ...ZERO })
  );

  const [snapshot, reconciliation] = await Promise.all([getBalanceSnapshot(), getPaybillReconciliation(days)]);
  return {
    range: { dateFrom: start.toISOString(), dateTo: end.toISOString(), timezone: TZ },
    totals,
    days,
    snapshot,
    reconciliation,
  };
};

const dayStart = (day) => new Date(`${day}T00:00:00+03:00`);
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const diff = (a, b) => (a == null || b == null ? null : round2(a - b));

// Paybill reconciliation per day, against the real Mamlaka balances.
//   Pay-in:  closing = opening + M-Pesa deposits − provider charges − sweeps out
//   Payout:  closing = opening − M-Pesa paid out + top-ups − provider charges
// "unexplained" is what is left after our own books; it must be matched to the top-ups,
// sweeps and charges on the Mamlaka statement. Zero unexplained with no such lines = balanced.
const getPaybillReconciliation = async (days) => {
  const today = nairobiDay(new Date());
  let live = null;
  const liveReading = async () => {
    live = live || (await providerBalances.readLiveBalances().catch((error) => ({ error: error.message })));
    return live;
  };

  const rows = [];
  for (const day of days) {
    const opening = await providerBalances.readingAt(dayStart(day.date));
    const closing = day.date >= today ? await liveReading() : await providerBalances.readingAt(dayStart(nextDay(day.date)));
    const side = (key, expectedChange) => {
      const open = opening?.[key] ?? null;
      const close = closing?.[key] ?? null;
      const actualChange = diff(close, open);
      return { opening: open, closing: close, expectedChange: round2(expectedChange), actualChange, unexplained: diff(actualChange, expectedChange) };
    };
    rows.push({
      date: day.date,
      closingIsLive: day.date >= today,
      payin: side('payinKes', day.mpesaDeposits),
      payout: side('payoutKes', -day.mpesaPaidOut),
    });
  }

  const pending = await Transaction.aggregate([
    { $match: { type: 'withdrawal', status: 'pending', walletType: { $ne: 'airtime' } } },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$netAmount', '$amount'] } } } },
  ]);

  return {
    live: await liveReading(),
    days: rows,
    // Withdrawals still in flight: money may already have left the payout account
    // without the transaction being completed in our books yet.
    pendingWithdrawals: { count: pending[0]?.count || 0, amount: round2(pending[0]?.amount) },
  };
};

// Balances right now (not as of the end of the range): what is owed to players
// and what is available to pay withdrawals.
const getBalanceSnapshot = async () => {
  const [[wallets], payoutFloat] = await Promise.all([
    User.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          playerCash: { $sum: { $convert: { input: '$balance', to: 'double', onError: 0, onNull: 0 } } },
          playerBonus: { $sum: { $convert: { input: '$bonusBalance', to: 'double', onError: 0, onNull: 0 } } },
          playerAirtime: { $sum: { $convert: { input: '$airtimeBalance', to: 'double', onError: 0, onNull: 0 } } },
        },
      },
    ]),
    payoutFloatService.getPayoutFloat(),
  ]);
  return {
    asOf: new Date().toISOString(),
    playerCash: round2(wallets?.playerCash),
    playerBonus: round2(wallets?.playerBonus),
    playerAirtime: round2(wallets?.playerAirtime),
    payoutFloat: round2(payoutFloat.balance),
    payoutFloatReserved: round2(payoutFloat.reserved),
  };
};

const CSV_COLUMNS = [
  ['Date', 'date'],
  ['Deposits (count)', 'depositsCount'],
  ['Deposits (KES)', 'deposits'],
  ['Airtime wallet deposits', 'airtimeDeposits'],
  ['Withdrawals (count)', 'withdrawalsCount'],
  ['Withdrawals debited from wallets', 'withdrawalsDebited'],
  ['Withdrawals paid out', 'withdrawalsPaidOut'],
  ['Withdrawal tax (owed to KRA)', 'withdrawalTax'],
  ['Withdrawal fees (revenue)', 'withdrawalFees'],
  ['Airtime wallet withdrawals', 'airtimeWithdrawals'],
  ['M-Pesa deposits (paybill)', 'mpesaDeposits'],
  ['M-Pesa paid out (paybill)', 'mpesaPaidOut'],
  ['Comet paid out', 'cometPaidOut'],
  ['Net cash flow', 'netCashFlow'],
  ['Virtual bets', 'virtualBets'],
  ['Virtual stakes', 'virtualStakes'],
  ['Virtual payouts', 'virtualPayouts'],
  ['Virtual refunds', 'virtualRefunds'],
  ['Virtual GGR', 'virtualGgr'],
  ['Sportsbook bets', 'sportsbookBets'],
  ['Sportsbook stakes', 'sportsbookStakes'],
  ['Sportsbook payouts', 'sportsbookPayouts'],
  ['Sportsbook refunds', 'sportsbookRefunds'],
  ['Sportsbook GGR', 'sportsbookGgr'],
  ['Total GGR', 'ggr'],
  ['Welcome bonuses', 'welcomeBonuses'],
  ['Referral bonuses', 'referralBonuses'],
  ['Cashback', 'cashback'],
  ['Bonus cost', 'bonusCost'],
  ['Net revenue', 'netRevenue'],
  ['Manual credits', 'manualCredits'],
  ['Balances zeroed by staff', 'manualZeroed'],
];

async function* financeCsvRows(report) {
  for (const row of report.days) yield CSV_COLUMNS.map(([, key]) => row[key]);
  yield CSV_COLUMNS.map(([, key]) => (key === 'date' ? 'TOTAL' : report.totals[key]));
}

module.exports = {
  getFinanceReport,
  getBalanceSnapshot,
  financeCsvRows,
  CSV_HEADERS: CSV_COLUMNS.map(([label]) => label),
  deriveRow,
  listDays,
  resolveRange,
};
