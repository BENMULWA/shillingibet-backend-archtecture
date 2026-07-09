'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../../config');
const logger = require('../../utils/logger');
const client = require('../../integrations/eurovirtuals/eurovirtuals.client');
const User = require('../user/user.model');
const VirtualTxn = require('./virtualTxn.model');
const VirtualSession = require('./virtualSession.model');

const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;
const parsePositiveAmount = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const amount = Number(val);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return round2(amount);
};
const pickFirstPresent = (sources, keys) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== null && value !== undefined && value !== '') return value;
    }
  }
  return null;
};
const nestedBody = (body = {}) =>
  body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
const resolveWinAmount = (body = {}) => {
  return pickFirstPresent([body, nestedBody(body)], [
    'payout_amount',
    'amount',
    'payout',
    'won_amount',
    'payoutAmount',
    'wonAmount',
    'win_amount',
    'winAmount',
  ]);
};
const resolveOutcomeStatus = (body = {}) => {
  return pickFirstPresent([body, nestedBody(body)], [
    'status_description',
    'status',
    'statusDescription',
    'result',
    'outcome',
    'bet_status',
    'betStatus',
  ]);
};
const resolveProviderPlayerId = (body = {}) =>
  pickFirstPresent([body, nestedBody(body)], ['player_id', 'playerId', 'user_id', 'userId']);
const resolveProviderGameUuid = (body = {}) =>
  pickFirstPresent([body, nestedBody(body)], ['game_uuid', 'gameUuid']);
const resolveProviderGameName = (body = {}) =>
  pickFirstPresent([body, nestedBody(body)], ['game_name', 'gameName']);
const resolveOperatorReferenceId = (body = {}) =>
  pickFirstPresent([body, nestedBody(body)], ['operator_reference_id', 'operatorReferenceId', 'reference_id', 'referenceId']);
const resolveProviderTransactionId = (body = {}) =>
  pickFirstPresent([body, nestedBody(body)], ['transaction_id', 'transactionId']);
const resolvePlaceBetId = (body = {}) =>
  pickFirstPresent([body, nestedBody(body)], ['bet_id', 'betId', 'transaction_id', 'transactionId']);
const resolveCallbackAction = (body = {}) =>
  String(pickFirstPresent([body, nestedBody(body)], ['action']) || '').trim();
const resolveStatusCode = (body = {}) => {
  const raw = pickFirstPresent([body, nestedBody(body)], ['status']);
  if (raw === null || raw === undefined || raw === '') return null;
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
};
const CREDIT_WIN_STATUSES = new Set([2]);
const NO_CREDIT_WIN_STATUSES = new Set([1, 3, 4, 5, 7]);
const ACCEPTED_WIN_STATUSES = new Set([...CREDIT_WIN_STATUSES, ...NO_CREDIT_WIN_STATUSES]);
const now = () =>
  new Date().toISOString().replace('T', ' ').slice(0, 19);

const incPipeline = (delta) => [
  { $set: { balance: { $round: [{ $add: ['$balance', delta] }, 2] } } },
];

const CODES = {
  SUCCESS: 200,
  INSUFFICIENT: 402,
  MISSING_PARAMS: 400,
  UNAUTHORISED: 401,
  ERROR: 500,
};

const result = (status_code, status_description, data) => {
  const out = { status_code, status_description };
  if (data) out.data = data;
  return out;
};

const buildError = (message) => result(CODES.ERROR, message || 'Internal Server Error');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const resolvePlayer = async (playerId, playerToken) => {
  if (!playerId || !isValidObjectId(playerId)) return null;
  const user = await User.findById(playerId).lean();
  if (!user) return null;

  if (playerToken) {
    const session = await VirtualSession.findOne({ token: playerToken }).lean();
    if (!session || String(session.user) !== String(user._id)) {
      logger.warn('EV player_token did not match an active session', playerId);
    }
  }
  return user;
};

const resolvePlayerWithRequiredSession = async (playerId, playerToken) => {
  if (!playerToken) {
    logger.warn('EV player_token missing for player', playerId);
    return null;
  }
  if (!playerId || !isValidObjectId(playerId)) return null;

  const user = await User.findById(playerId).lean();
  if (!user) return null;

  const session = await VirtualSession.findOne({ token: playerToken }).lean();
  if (!session || String(session.user) !== String(user._id)) {
    logger.warn('EV player_token did not match an active session', playerId);
    return null;
  }

  return user;
};

const issueSession = async (userId) => {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + config.eurovirtuals.sessionTtlHours * 3600 * 1000);
  await VirtualSession.create({ user: userId, token, expiresAt });
  return token;
};

const playerInfo = async ({ body }) => {
  const { player_id, player_token } = body || {};
  if (!player_id) return result(CODES.MISSING_PARAMS, 'Missing required parameters');

  const user = await resolvePlayerWithRequiredSession(player_id, player_token);
  if (!user) return result(CODES.UNAUTHORISED, 'Unauthorised access');

  return result(CODES.SUCCESS, 'Success', {
    balance: round2(user.balance),
    currency: config.eurovirtuals.currency,
    reference_id: crypto.randomUUID(),
    date: now(),
  });
};

const uniqueValues = (values = []) => [...new Set(values.filter(Boolean).map((value) => String(value)))];
const buildTxnLookup = ({ betId, providerTransactionId, operatorReferenceId }) =>
  uniqueValues([
    betId,
    providerTransactionId,
    operatorReferenceId,
  ]);
const buildTxnLookupQuery = (identifiers, action) => {
  const or = [];
  for (const identifier of identifiers) {
    or.push({ betId: identifier });
    or.push({ providerTransactionId: identifier });
    or.push({ operatorReferenceId: identifier });
  }
  return { action, $or: or };
};
const existingByAction = (lookup, action) => {
  const identifiers = buildTxnLookup(lookup);
  if (!identifiers.length) return Promise.resolve(null);
  return VirtualTxn.findOne(buildTxnLookupQuery(identifiers, action)).lean();
};
const findPlaceTxn = (lookup) => {
  const identifiers = buildTxnLookup(lookup);
  if (!identifiers.length) return Promise.resolve(null);
  return VirtualTxn.findOne(buildTxnLookupQuery(identifiers, 'place_bet')).lean();
};

const flattenObjects = (value, bucket = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => flattenObjects(item, bucket));
    return bucket;
  }
  if (value && typeof value === 'object') {
    bucket.push(value);
    Object.values(value).forEach((item) => flattenObjects(item, bucket));
  }
  return bucket;
};

const normalizeComparable = (value) => (value == null ? null : String(value));

const scoreProviderStatusCandidate = (entry = {}) => {
  let score = 0;
  if (resolveWinAmount(entry) != null) score += 4;
  if (resolveOutcomeStatus(entry)) score += 2;
  if (resolveProviderGameUuid(entry)) score += 2;
  if (resolveOperatorReferenceId(entry)) score += 1;
  if (resolveProviderGameName(entry)) score += 1;
  return score;
};

const extractProviderBetStatus = (providerBody, betId) => {
  const targetBetId = normalizeComparable(betId);
  const objects = flattenObjects(providerBody);
  const matches = objects.filter((entry) => {
    const candidateId = normalizeComparable(entry.bet_id ?? entry.betId ?? entry.id);
    return candidateId && candidateId === targetBetId;
  });
  const matched = matches.sort((left, right) => scoreProviderStatusCandidate(right) - scoreProviderStatusCandidate(left))[0];

  if (!matched) return null;

  return {
    raw: matched,
    betId: normalizeComparable(matched.bet_id ?? matched.betId ?? matched.id),
    payoutAmount: resolveWinAmount(matched),
    status: resolveOutcomeStatus(matched),
    operatorReferenceId: resolveOperatorReferenceId(matched),
    gameUuid: resolveProviderGameUuid(matched),
    gameName: resolveProviderGameName(matched),
  };
};

const resolvePlayerContext = async ({ lookup, playerId, playerToken }) => {
  const directUser = await resolvePlayer(playerId, playerToken);
  if (directUser) return { user: directUser, placeTxn: null, source: 'callback_player' };
  if (!buildTxnLookup(lookup).length) return { user: null, placeTxn: null, source: 'missing_bet' };

  const placeTxn = await findPlaceTxn(lookup);
  if (!placeTxn) return { user: null, placeTxn: null, source: 'missing_place_bet' };

  const fallbackUser = await User.findById(placeTxn.user).lean();
  if (!fallbackUser) return { user: null, placeTxn, source: 'missing_place_user' };

  return { user: fallbackUser, placeTxn, source: 'place_bet_fallback' };
};

const placeBet = async ({ body }) => {
  const { amount, currency, player_id, player_token, game_uuid, game_name, type } = body || {};
  const bet_id = resolvePlaceBetId(body);
  const providerTransactionId = resolveProviderTransactionId(body);
  const operatorReferenceId = resolveOperatorReferenceId(body);
  if (!bet_id || amount == null || !player_id) {
    return result(CODES.MISSING_PARAMS, 'Missing required parameters');
  }

  const user = await resolvePlayer(player_id, player_token);
  if (!user) return result(CODES.UNAUTHORISED, 'Unauthorised access');

  const debit = round2(amount);
  const cur = currency || config.eurovirtuals.currency;

  const dup = await existingByAction(bet_id, 'place_bet');
  if (dup) {
    const fresh = await User.findById(user._id).lean();
    return {
      ...result(CODES.SUCCESS, 'Success', { balance: round2(fresh.balance), currency: cur, reference_id: dup.referenceId, date: now() }),
      _isDuplicate: true,
    };
  }

  const debited = await User.findOneAndUpdate(
    { _id: user._id, balance: { $gte: debit } },
    incPipeline(-debit),
    { new: true }
  ).lean();
  if (!debited) return result(CODES.INSUFFICIENT, 'Insufficient Balance');

  const referenceId = crypto.randomUUID();
  try {
    await VirtualTxn.create({
      user: user._id,
      betId: bet_id,
      providerTransactionId,
      action: 'place_bet',
      type,
      gameUuid: game_uuid,
      gameName: game_name,
      currency: cur,
      amount: debit,
      delta: -debit,
      balanceAfter: round2(debited.balance),
      referenceId,
      operatorReferenceId,
      raw: body,
    });
  } catch (err) {
    if (err.code === 11000) {
      await User.updateOne({ _id: user._id }, incPipeline(debit));
      const fresh = await User.findById(user._id).lean();
      return { ...result(CODES.SUCCESS, 'Success', { balance: round2(fresh.balance), currency: cur }), _isDuplicate: true };
    }
    throw err;
  }

  return result(CODES.SUCCESS, 'Success', {
    balance: round2(debited.balance),
    currency: cur,
    reference_id: referenceId,
    date: now(),
  });
};

const winBet = async ({ body }) => {
  const { currency, player_token } = body || {};
  const bet_id = resolvePlaceBetId(body);
  const action = resolveCallbackAction(body);
  const status = resolveStatusCode(body);
  const payoutAmount = resolveWinAmount(body);
  const providerTransactionId = resolveProviderTransactionId(body);
  const operatorReferenceId = resolveOperatorReferenceId(body);
  if (!bet_id || payoutAmount == null) {
    return result(CODES.MISSING_PARAMS, 'Missing required parameters');
  }

  if (!['result_bet', 'result_freebet'].includes(action)) {
    return result(CODES.MISSING_PARAMS, 'Invalid win action');
  }

  if (!ACCEPTED_WIN_STATUSES.has(status)) {
    return result(CODES.MISSING_PARAMS, 'Unsupported win status');
  }

  const credit = CREDIT_WIN_STATUSES.has(status) ? parsePositiveAmount(payoutAmount) : 0;
  if (CREDIT_WIN_STATUSES.has(status) && (credit === null || credit <= 0)) {
    return result(CODES.MISSING_PARAMS, 'payout_amount must be a positive number');
  }

  const playerContext = await resolvePlayerContext({
    lookup: {
      betId: bet_id,
      providerTransactionId,
      operatorReferenceId,
    },
    playerId: resolveProviderPlayerId(body),
    playerToken: player_token,
  });
  const { user, placeTxn } = playerContext;
  if (!user) return result(CODES.UNAUTHORISED, 'Unauthorised access');

  const canonicalBetId = placeTxn?.betId || bet_id;
  const cur = currency || config.eurovirtuals.currency;
  const gameUuid = resolveProviderGameUuid(body) || placeTxn?.gameUuid || null;
  const gameName = resolveProviderGameName(body) || placeTxn?.gameName || null;

  const dup = await existingByAction(
    {
      betId: canonicalBetId,
      providerTransactionId,
      operatorReferenceId,
    },
    action
  );
  if (dup) {
    const fresh = await User.findById(user._id).lean();
    return {
      ...result(CODES.SUCCESS, 'Success', {
        balance: round2(fresh.balance),
        currency: cur,
        reference_id: dup.referenceId,
        date: now(),
      }),
      _isDuplicate: true,
    };
  }

  if (NO_CREDIT_WIN_STATUSES.has(status)) {
    const fresh = await User.findById(user._id).lean();
    const referenceId = crypto.randomUUID();
    const unchangedBalance = round2(fresh?.balance);

    try {
      await VirtualTxn.create({
        user: user._id,
        betId: canonicalBetId,
        providerTransactionId,
        action,
        gameUuid,
        gameName,
        currency: cur,
        payout: 0,
        delta: 0,
        balanceAfter: unchangedBalance,
        referenceId,
        operatorReferenceId,
        raw: body,
      });
    } catch (err) {
      if (err.code === 11000) {
        const latest = await User.findById(user._id).lean();
        return {
          ...result(CODES.SUCCESS, 'Success', {
            balance: round2(latest.balance),
            currency: cur,
            date: now(),
          }),
          _isDuplicate: true,
        };
      }
      throw err;
    }

    return result(CODES.SUCCESS, 'Success', {
      balance: unchangedBalance,
      currency: cur,
      reference_id: referenceId,
      date: now(),
    });
  }

  const referenceId = crypto.randomUUID();
  const credited = await User.findByIdAndUpdate(
    user._id,
    incPipeline(credit),
    { new: true }
  ).lean();

  try {
    await VirtualTxn.create({
      user: user._id,
      betId: canonicalBetId,
      providerTransactionId,
      action,
      gameUuid,
      gameName,
      currency: cur,
      payout: credit,
      delta: credit,
      balanceAfter: round2(credited.balance),
      referenceId,
      operatorReferenceId,
      raw: body,
    });
  } catch (err) {
    if (err.code === 11000) {
      await User.updateOne({ _id: user._id }, incPipeline(-credit));
      const fresh = await User.findById(user._id).lean();
      return {
        ...result(CODES.SUCCESS, 'Success', { balance: round2(fresh.balance), currency: cur, date: now() }),
        _isDuplicate: true,
      };
    }
    throw err;
  }

  return result(CODES.SUCCESS, 'Success', {
    balance: round2(credited.balance),
    currency: cur,
    reference_id: referenceId,
    date: now(),
  });
};

const rollbackBet = async ({ body }) => {
  const { currency, player_token } = body || {};
  const bet_id = resolvePlaceBetId(body);
  const providerTransactionId = resolveProviderTransactionId(body);
  if (!bet_id) {
    return result(CODES.MISSING_PARAMS, 'Missing required parameters');
  }

  const playerContext = await resolvePlayerContext({
    lookup: {
      betId: bet_id,
      providerTransactionId,
      operatorReferenceId: resolveOperatorReferenceId(body),
    },
    playerId: resolveProviderPlayerId(body),
    playerToken: player_token,
  });
  const { user, placeTxn } = playerContext;
  if (!user) return result(CODES.UNAUTHORISED, 'Unauthorised access');

  const canonicalBetId = placeTxn?.betId || bet_id;
  const cur = currency || config.eurovirtuals.currency;
  const operatorReferenceId = resolveOperatorReferenceId(body);

  const dup = await existingByAction(
    {
      betId: canonicalBetId,
      providerTransactionId,
      operatorReferenceId,
    },
    'rollback_bet'
  );
  if (dup) {
    const fresh = await User.findById(user._id).lean();
    return {
      ...result(CODES.SUCCESS, 'Success', { balance: round2(fresh.balance), currency: cur, reference_id: dup.referenceId, date: now() }),
      _isDuplicate: true,
    };
  }

  const prior = await VirtualTxn.find({ betId: canonicalBetId, action: { $in: ['place_bet', 'result_bet'] } }).lean();
  const netApplied = prior.reduce((sum, t) => sum + t.delta, 0);
  const reverseDelta = round2(-netApplied);

  const referenceId = crypto.randomUUID();
  const updated = await User.findByIdAndUpdate(
    user._id,
    incPipeline(reverseDelta),
    { new: true }
  ).lean();

  if (updated.balance < 0) logger.warn('EV rollback drove balance negative', bet_id, updated.balance);

  try {
    await VirtualTxn.create({
      user: user._id,
      betId: canonicalBetId,
      providerTransactionId,
      action: 'rollback_bet',
      currency: cur,
      delta: reverseDelta,
      balanceAfter: round2(updated.balance),
      referenceId,
      operatorReferenceId,
      raw: body,
    });
  } catch (err) {
    if (err.code === 11000) {
      await User.updateOne({ _id: user._id }, incPipeline(-reverseDelta));
      const fresh = await User.findById(user._id).lean();
      return { ...result(CODES.SUCCESS, 'Success', { balance: round2(fresh.balance), currency: cur, date: now() }), _isDuplicate: true };
    }
    throw err;
  }

  return result(CODES.SUCCESS, 'Success', {
    balance: round2(updated.balance),
    currency: cur,
    reference_id: referenceId,
    date: now(),
  });
};

const reconcileBetStatus = async ({ gameUuid, betId }) => {
  if (!betId) return { ok: false, reason: 'bet_id required' };

  const placeTxn = await findPlaceTxn({ betId });
  if (!placeTxn) return { ok: false, reason: 'place_bet transaction not found' };

  const resolvedGameUuid = gameUuid || placeTxn.gameUuid;
  if (!resolvedGameUuid) return { ok: false, reason: 'game_uuid required' };

  const providerRes = await client.getBetStatus({ gameUuid: resolvedGameUuid, betIds: betId });
  if (!providerRes || !providerRes.body) {
    return { ok: false, reason: 'provider_unreachable' };
  }

  const status = extractProviderBetStatus(providerRes.body, betId);
  if (!status) {
    return { ok: false, reason: 'bet status not found in provider response', provider: providerRes.body };
  }

  const positivePayout = parsePositiveAmount(status.payoutAmount);
  if (positivePayout === null) {
    return {
      ok: true,
      reconciled: false,
      reason: 'provider did not return a positive payout',
      provider: status,
    };
  }

  const winResult = await winBet({
    body: {
      bet_id: betId,
      player_id: String(placeTxn.user),
      payout_amount: positivePayout,
      currency: placeTxn.currency || config.eurovirtuals.currency,
      game_uuid: status.gameUuid || placeTxn.gameUuid,
      game_name: status.gameName || placeTxn.gameName,
      operator_reference_id: status.operatorReferenceId || null,
      data: status.raw,
      status: status.status,
    },
  });

  return {
    ok: winResult.status_code === CODES.SUCCESS,
    reconciled: winResult.status_code === CODES.SUCCESS,
    idempotent: Boolean(winResult._isDuplicate),
    provider: status,
    wallet: winResult,
  };
};

module.exports = {
  playerInfo,
  placeBet,
  winBet,
  rollbackBet,
  reconcileBetStatus,
  extractProviderBetStatus,
  buildError,
  issueSession,
  CODES,
};
