'use strict';

const User = require('../user/user.model');
const Bet = require('../bet/bet.model');
const Transaction = require('../transaction/transaction.model');
const VirtualTxn = require('../virtual/virtualTxn.model');
const virtualService = require('../virtual/virtual.service');

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

  const [registeredUsers, referredUsers, totalReferralBonus, totalBetAmount, totalWinAmount, totalDeposits, totalWithdrawals, totalRollbackAmount, playersBalance, lostStakeTotal] =
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
    ]);

  return {
    range: {
      dateFrom: dateFrom ? dateFrom.toISOString() : null,
      dateTo: dateTo ? dateTo.toISOString() : null,
    },
    cards: {
      registeredUsers,
      referredUsers,
      totalRevenue: lostStakeTotal,
      betAmount: totalBetAmount,
      winAmount: totalWinAmount,
      profit: round2(lostStakeTotal - totalWinAmount),
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      tax: 0,
      referralBonus: totalReferralBonus,
      cashback: 0,
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

  const [betRows, settlementRows, transactionRows] = await Promise.all([
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
    value.revenue = round2(row.revenue);
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
