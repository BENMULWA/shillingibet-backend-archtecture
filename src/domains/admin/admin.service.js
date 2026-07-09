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

module.exports = { getOverview, reconcileVirtualBet };
