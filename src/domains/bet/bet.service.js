'use strict';

const ApiError = require('../../utils/ApiError');
const {
  withTransaction,
  incWalletBalance,
  normalizeWalletType,
  walletBalanceField,
  walletBalanceQuery,
} = require('../../utils/db');
const Bet = require('./bet.model');
const Event = require('../event/event.model');
const User = require('../user/user.model');

const round2 = (n) => Math.round(n * 100) / 100;

const validateEventForBet = (event, selectionKey) => {
  if (!event) throw ApiError.notFound('Event not found');
  if (event.status !== 'scheduled') throw ApiError.badRequest('Event is not open for betting');
  if (new Date(event.startTime) <= new Date()) throw ApiError.badRequest('Event has already started');

  const selection = event.selections.find((s) => s.key === selectionKey);
  if (!selection) throw ApiError.badRequest(`Unknown selection: ${selectionKey}`);
  return selection;
};

const buildBetDoc = (userId, eventId, selection, stake, walletType) => ({
  user: userId,
  event: eventId,
  selectionKey: selection.key,
  selectionLabel: selection.label,
  odds: selection.odds,
  stake,
  potentialPayout: round2(stake * selection.odds),
  walletType,
});

const placeInSession = async (session, user, { eventId, selectionKey, stake, walletType: requestedWalletType }) => {
  const event = await Event.findById(eventId).session(session).lean();
  const selection = validateEventForBet(event, selectionKey);
  const walletType = normalizeWalletType(requestedWalletType || user.activeWallet);
  const field = walletBalanceField(walletType);

  const debited = await User.findOneAndUpdate(
    { _id: user._id, ...walletBalanceQuery(walletType, stake) },
    incWalletBalance(walletType, -stake),
    { new: true, session }
  );
  if (!debited) throw ApiError.badRequest(`Insufficient ${field === 'airtimeBalance' ? 'airtime balance' : 'balance'}`);

  const [bet] = await Bet.create([buildBetDoc(user._id, eventId, selection, stake, walletType)], { session });
  return bet.toJSON();
};

const placeCompensating = async (user, { eventId, selectionKey, stake, walletType: requestedWalletType }) => {
  const event = await Event.findById(eventId).lean();
  const selection = validateEventForBet(event, selectionKey);
  const walletType = normalizeWalletType(requestedWalletType || user.activeWallet);
  const field = walletBalanceField(walletType);

  const debited = await User.findOneAndUpdate(
    { _id: user._id, ...walletBalanceQuery(walletType, stake) },
    incWalletBalance(walletType, -stake),
    { new: true }
  ).lean();
  if (!debited) throw ApiError.badRequest(`Insufficient ${field === 'airtimeBalance' ? 'airtime balance' : 'balance'}`);

  try {
    const bet = await Bet.create(buildBetDoc(user._id, eventId, selection, stake, walletType));
    return bet.toJSON();
  } catch (err) {
    await User.updateOne({ _id: user._id }, incWalletBalance(walletType, stake));
    throw err;
  }
};

const place = (user, payload) =>
  withTransaction(
    (session) => placeInSession(session, user, payload),
    () => placeCompensating(user, payload)
  );

const listForUser = async (userId, { status, page, limit }) => {
  const filter = { user: userId };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    Bet.find(filter)
      .populate('event', 'homeTeam awayTeam sport startTime status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Bet.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
};

const getById = async (userId, id) => {
  const bet = await Bet.findOne({ _id: id, user: userId })
    .populate('event', 'homeTeam awayTeam sport startTime status result')
    .lean();
  if (!bet) throw ApiError.notFound('Bet not found');
  return bet;
};

const settleWinningBet = (bet) =>
  withTransaction(
    async (session) => {
      const updated = await Bet.findOneAndUpdate(
        { _id: bet._id, status: 'open' },
        { status: 'won', settledAt: new Date() },
        { new: true, session }
      );
      if (!updated) return false;
      await User.updateOne(
        { _id: bet.user },
        incWalletBalance(bet.walletType, bet.potentialPayout),
        { session }
      );
      return true;
    },
    async () => {
      const updated = await Bet.findOneAndUpdate(
        { _id: bet._id, status: 'open' },
        { status: 'won', settledAt: new Date() },
        { new: true }
      );
      if (!updated) return false;
      await User.updateOne({ _id: bet.user }, incWalletBalance(bet.walletType, bet.potentialPayout));
      return true;
    }
  );

const settleForEvent = async (eventId, winningKey) => {
  const openBets = await Bet.find({ event: eventId, status: 'open' }).lean();
  let won = 0;
  let lost = 0;
  let paidOut = 0;

  for (const bet of openBets) {
    if (bet.selectionKey === winningKey) {
      const credited = await settleWinningBet(bet);
      if (credited) {
        won += 1;
        paidOut = round2(paidOut + bet.potentialPayout);
      }
    } else {
      const updated = await Bet.findOneAndUpdate(
        { _id: bet._id, status: 'open' },
        { status: 'lost', settledAt: new Date() },
        { new: true }
      );
      if (updated) lost += 1;
    }
  }

  return { total: openBets.length, won, lost, paidOut };
};

module.exports = { place, listForUser, getById, settleForEvent };
