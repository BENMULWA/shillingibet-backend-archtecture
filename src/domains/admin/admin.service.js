'use strict';

const User = require('../user/user.model');
const Bet = require('../bet/bet.model');
const Transaction = require('../transaction/transaction.model');
const VirtualTxn = require('../virtual/virtualTxn.model');
const virtualService = require('../virtual/virtual.service');
const CashbackAward = require('../cashback/cashbackAward.model');
const ReferralAward = require('../user/referralAward.model');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const buildRange = (dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return null;
  const range = {};
  if (dateFrom) range.$gte = dateFrom;
  if (dateTo) range.$lte = dateTo;
  return range;
};

const sumField = async (Model, match, field) => {
  const [row] = await Model.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]);
  return round2(row?.total || 0);
};

const countDocs = (Model, match) => Model.countDocuments(match);

const getOverview = async ({ dateFrom, dateTo }) => {
  const createdRange = buildRange(dateFrom, dateTo);
  const settledRange = buildRange(dateFrom, dateTo);
  const completedRange = buildRange(dateFrom, dateTo);

  const userMatch = { role: 'user' };
  if (createdRange) userMatch.createdAt = createdRange;

  const referredUserMatch = { referredBy: { $ne: null } };
  if (createdRange) referredUserMatch.createdAt = createdRange;

  const betCreatedMatch = {};
  if (createdRange) betCreatedMatch.createdAt = createdRange;

  const betWonMatch = { status: 'won' };
  if (settledRange) betWonMatch.settledAt = settledRange;

  const betLostMatch = { status: 'lost' };
  if (settledRange) betLostMatch.settledAt = settledRange;

  const depositMatch = { type: 'deposit', status: 'completed' };
  if (completedRange) depositMatch.completedAt = completedRange;

  const withdrawalMatch = { type: 'withdrawal', status: 'completed' };
  if (completedRange) withdrawalMatch.completedAt = completedRange;

  const rollbackMatch = { action: 'rollback_bet' };
  if (createdRange) rollbackMatch.createdAt = createdRange;

  const [registeredUsers, referredUsers, totalReferralBonus, totalBetAmount, totalWinAmount, totalDeposits, totalWithdrawals, totalRollbackAmount, playersBalance, lostStakeTotal, withdrawalTax, withdrawalFees, withdrawalsPaidOut] =
    await Promise.all([
      countDocs(User, userMatch),
      countDocs(User, referredUserMatch),
      sumField(User, { role: 'user' }, 'referralStats.bonusEarned'),
      sumField(Bet, betCreatedMatch, 'stake'),
      sumField(Bet, betWonMatch, 'potentialPayout'),
      sumField(Transaction, depositMatch, 'amount'),
      sumField(Transaction, withdrawalMatch, 'amount'),
      sumField(VirtualTxn, rollbackMatch, 'delta').then((v) => round2(Math.abs(v))),
      sumField(User, { role: 'user' }, 'balance'),
      sumField(Bet, betLostMatch, 'stake'),
      // Charges kept from completed cash withdrawals (see withdrawalCharges.js).
      sumField(Transaction, withdrawalMatch, 'taxAmount'),
      sumField(Transaction, withdrawalMatch, 'feeAmount'),
      Transaction.aggregate([
        { $match: withdrawalMatch },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$netAmount', '$amount'] } } } },
      ]).then((rows) => round2(rows[0]?.total || 0)),
    ]);

  // Virtual games are where almost all play happens; count them with the sportsbook.
  const virtualMatch = { currency: 'KES' };
  if (createdRange) virtualMatch.createdAt = createdRange;
  const anyDeposit = { type: 'deposit' };
  if (createdRange) anyDeposit.createdAt = createdRange;
  const failedDepositMatch = { ...anyDeposit, status: { $in: ['failed', 'expired'] } };
  const stuckSince = new Date(Date.now() - 30 * 60 * 1000);

  const [virtualRows, sportsbookRefunds, virtualBettors, sportsbookBettors, sportsbookBetCount, depositCount, withdrawalCount,
    failedDeposits, firstTimeDepositors, cashbackTotal, walletRows, pendingRows, manualReview, heldReferralAwards] = await Promise.all([
    VirtualTxn.aggregate([
      { $match: virtualMatch },
      {
        $group: {
          _id: null,
          bets: { $sum: { $cond: [{ $eq: ['$action', 'place_bet'] }, 1, 0] } },
          stakes: { $sum: { $cond: [{ $eq: ['$action', 'place_bet'] }, '$amount', 0] } },
          payouts: { $sum: { $cond: [{ $in: ['$action', ['result_bet', 'result_freebet']] }, '$payout', 0] } },
        },
      },
    ]),
    sumField(Bet, { status: 'void', ...(settledRange ? { settledAt: settledRange } : {}) }, 'stake'),
    VirtualTxn.distinct('user', { ...virtualMatch, action: 'place_bet' }),
    Bet.distinct('user', betCreatedMatch),
    countDocs(Bet, betCreatedMatch),
    countDocs(Transaction, depositMatch),
    countDocs(Transaction, withdrawalMatch),
    countDocs(Transaction, failedDepositMatch),
    // Players whose very first completed deposit falls in this period.
    Transaction.aggregate([
      { $match: { type: 'deposit', status: 'completed' } },
      { $group: { _id: '$user', first: { $min: '$completedAt' } } },
      ...(completedRange ? [{ $match: { first: completedRange } }] : []),
      { $count: 'n' },
    ]).then((rows) => rows[0]?.n || 0),
    sumField(CashbackAward, completedRange ? { creditedAt: completedRange } : {}, 'amount'),
    User.aggregate([
      { $match: { role: 'user', deletedAt: null } },
      {
        $group: {
          _id: null,
          bonus: { $sum: '$bonusBalance' },
          withdrawable: { $sum: { $max: [{ $subtract: [{ $ifNull: ['$balance', 0] }, { $ifNull: ['$bonusBalance', 0] }] }, 0] } },
        },
      },
    ]),
    // "Needs attention" right now, not limited to the period.
    Transaction.aggregate([
      { $match: { type: 'withdrawal', status: 'pending' } },
      { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: { $ifNull: ['$netAmount', '$amount'] } } } },
    ]),
    countDocs(Transaction, { type: 'withdrawal', status: 'pending', createdAt: { $lt: stuckSince } }),
    countDocs(ReferralAward, { status: 'held' }),
  ]);

  const v = virtualRows[0] || {};
  const betAmount = round2(totalBetAmount + (v.stakes || 0));
  const winAmount = round2(totalWinAmount + (v.payouts || 0));
  // GGR = stakes − winnings − refunded stakes (virtual rollbacks and void sportsbook bets).
  const ggr = round2(betAmount - winAmount - totalRollbackAmount - sportsbookRefunds);
  const activeBettors = new Set([...virtualBettors, ...sportsbookBettors].map(String)).size;
  const wallets = walletRows[0] || {};

  return {
    range: {
      dateFrom: dateFrom ? dateFrom.toISOString() : null,
      dateTo: dateTo ? dateTo.toISOString() : null,
    },
    attention: {
      pendingWithdrawals: pendingRows[0]?.n || 0,
      pendingWithdrawalAmount: round2(pendingRows[0]?.amount),
      // Withdrawals still unconfirmed by the provider after 30 minutes.
      manualReview,
      heldReferralAwards,
    },
    cards: {
      registeredUsers,
      referredUsers,
      totalRevenue: ggr,
      betAmount,
      winAmount,
      profit: ggr,
      virtualStakes: round2(v.stakes),
      virtualPayouts: round2(v.payouts),
      sportsbookStakes: totalBetAmount,
      sportsbookRevenue: round2(lostStakeTotal - totalWinAmount),
      betCount: sportsbookBetCount + (v.bets || 0),
      activeBettors,
      depositCount,
      withdrawalCount,
      failedDeposits,
      firstTimeDepositors,
      playersBonusBalance: round2(wallets.bonus),
      playersWithdrawableBalance: round2(wallets.withdrawable),
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      tax: withdrawalTax,
      withdrawalTax,
      withdrawalFees,
      // What actually left the business; `withdrawals` is what was debited from wallets.
      withdrawalsPaidOut,
      withdrawalCharges: round2(withdrawalTax + withdrawalFees),
      referralBonus: totalReferralBonus,
      cashback: cashbackTotal,
      rollbackAmount: totalRollbackAmount,
      playersBalance,
    },
  };
};

const reconcileVirtualBet = (payload) => virtualService.reconcileBetStatus(payload);

const getMonthlyAnalytics = async ({ months }) => {
  const nairobiDate = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: 'numeric',
    })
      .formatToParts(new Date())
      .filter((part) => part.type === 'year' || part.type === 'month')
      .map(({ type, value }) => [type, Number(value)])
  );
  const firstCalendarMonth = new Date(
    Date.UTC(nairobiDate.year, nairobiDate.month - months, 1)
  );
  const firstMonth = new Date(firstCalendarMonth.getTime() - 3 * 60 * 60 * 1000);
  const dateFilter = { $gte: firstMonth };

  const [betRows, settlementRows, transactionRows, virtualRows] = await Promise.all([
    Bet.aggregate([
      { $match: { createdAt: dateFilter } },
      {
        $group: {
          _id: {
            year: { $year: { date: '$createdAt', timezone: 'Africa/Nairobi' } },
            month: { $month: { date: '$createdAt', timezone: 'Africa/Nairobi' } },
          },
          betAmount: { $sum: '$stake' },
        },
      },
    ]),
    Bet.aggregate([
      {
        $match: {
          settledAt: dateFilter,
          status: { $in: ['won', 'lost'] },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: { date: '$settledAt', timezone: 'Africa/Nairobi' } },
            month: { $month: { date: '$settledAt', timezone: 'Africa/Nairobi' } },
          },
          revenue: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, '$stake', 0] } },
          winAmount: {
            $sum: { $cond: [{ $eq: ['$status', 'won'] }, '$potentialPayout', 0] },
          },
        },
      },
    ]),
    Transaction.aggregate([
      {
        $match: {
          status: 'completed',
          completedAt: dateFilter,
          type: { $in: ['deposit', 'withdrawal'] },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: { date: '$completedAt', timezone: 'Africa/Nairobi' } },
            month: { $month: { date: '$completedAt', timezone: 'Africa/Nairobi' } },
          },
          deposits: { $sum: { $cond: [{ $eq: ['$type', 'deposit'] }, '$amount', 0] } },
          withdrawals: { $sum: { $cond: [{ $eq: ['$type', 'withdrawal'] }, '$amount', 0] } },
        },
      },
    ]),
    VirtualTxn.aggregate([
      { $match: { currency: 'KES', createdAt: dateFilter } },
      {
        $group: {
          _id: {
            year: { $year: { date: '$createdAt', timezone: 'Africa/Nairobi' } },
            month: { $month: { date: '$createdAt', timezone: 'Africa/Nairobi' } },
          },
          stakes: { $sum: { $cond: [{ $eq: ['$action', 'place_bet'] }, '$amount', 0] } },
          payouts: { $sum: { $cond: [{ $in: ['$action', ['result_bet', 'result_freebet']] }, '$payout', 0] } },
          refunds: { $sum: { $cond: [{ $eq: ['$action', 'rollback_bet'] }, '$delta', 0] } },
        },
      },
    ]),
  ]);

  const byMonth = new Map();
  for (const row of betRows) {
    const key = `${row._id.year}-${row._id.month}`;
    byMonth.set(key, {
      year: row._id.year,
      month: row._id.month,
      betAmount: round2(row.betAmount),
      revenue: 0,
      winAmount: 0,
    });
  }
  for (const row of settlementRows) {
    const key = `${row._id.year}-${row._id.month}`;
    const value = byMonth.get(key) || {
      year: row._id.year,
      month: row._id.month,
      betAmount: 0,
      revenue: 0,
      winAmount: 0,
    };
    // Sportsbook GGR: lost stakes minus winnings paid.
    value.revenue = round2(row.revenue - row.winAmount);
    value.winAmount = round2(row.winAmount);
    byMonth.set(key, value);
  }
  for (const row of transactionRows) {
    const key = `${row._id.year}-${row._id.month}`;
    const value = byMonth.get(key) || {
      year: row._id.year,
      month: row._id.month,
      betAmount: 0,
      revenue: 0,
      winAmount: 0,
    };
    value.deposits = round2(row.deposits);
    value.withdrawals = round2(row.withdrawals);
    byMonth.set(key, value);
  }

  // Virtual games: add stakes and payouts; revenue becomes total GGR for the month.
  for (const row of virtualRows) {
    const key = `${row._id.year}-${row._id.month}`;
    const value = byMonth.get(key) || { year: row._id.year, month: row._id.month, betAmount: 0, revenue: 0, winAmount: 0 };
    value.betAmount = round2((value.betAmount || 0) + row.stakes);
    value.winAmount = round2((value.winAmount || 0) + row.payouts);
    value.virtualRevenue = round2(row.stakes - row.payouts - row.refunds);
    value.revenue = round2((value.revenue || 0) + value.virtualRevenue);
    byMonth.set(key, value);
  }

  return Array.from({ length: months }, (_, index) => {
    const date = new Date(
      Date.UTC(firstCalendarMonth.getUTCFullYear(), firstCalendarMonth.getUTCMonth() + index, 1)
    );
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
    return byMonth.get(key) || {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      revenue: 0,
      betAmount: 0,
      winAmount: 0,
      deposits: 0,
      withdrawals: 0,
    };
  });
};

const getRecentActivity = async ({ limit }) => {
  const [transactions, bets, virtualTransactions, users] = await Promise.all([
    Transaction.find()
      .select('type status amount phone provider receipt createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Bet.find()
      .select('status stake selectionLabel createdAt settledAt user')
      .populate('user', 'phone')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    VirtualTxn.find()
      .select('action amount payout delta gameName gameUuid user createdAt')
      .populate('user', 'phone')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    User.find({ role: 'user' })
      .select('phone referredBy createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  const rows = [
    ...transactions.map((item) => ({
      id: `transaction-${item._id}`,
      kind: item.type,
      status: item.status,
      amount: item.amount,
      phone: item.phone,
      detail: item.receipt || item.provider,
      at: item.createdAt,
    })),
    ...bets.map((item) => ({
      id: `bet-${item._id}`,
      kind: item.status === 'won' || item.status === 'lost' ? 'settlement' : 'bet',
      status: item.status,
      amount: item.stake,
      phone: item.user?.phone,
      detail: item.selectionLabel,
      at: item.settledAt || item.createdAt,
    })),
    ...virtualTransactions.map((item) => ({
      id: `virtual-${item._id}`,
      kind: item.action === 'rollback_bet'
        ? 'rollback'
        : item.action === 'place_bet'
          ? 'bet'
          : 'settlement',
      status: item.action === 'result_bet' || item.action === 'result_freebet'
        ? item.payout > 0 ? 'won' : 'lost'
        : item.action,
      amount: item.action === 'rollback_bet' ? Math.abs(item.delta) : item.action === 'place_bet' ? item.amount : item.payout,
      phone: item.user?.phone,
      detail: item.gameName || item.gameUuid,
      at: item.createdAt,
    })),
    ...users.map((item) => ({
      id: `signup-${item._id}`,
      kind: 'signup',
      status: item.referredBy ? 'referred' : 'direct',
      phone: item.phone,
      at: item.createdAt,
    })),
  ];

  return rows
    .sort((left, right) => new Date(right.at) - new Date(left.at))
    .slice(0, limit);
};

module.exports = {
  getOverview,
  getMonthlyAnalytics,
  getRecentActivity,
  reconcileVirtualBet,
};
