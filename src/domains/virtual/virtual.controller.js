'use strict';

const logger = require('../../utils/logger');
const service = require('./virtual.service');
const client = require('../../integrations/eurovirtuals/eurovirtuals.client');
const config = require('../../config');
const User = require('../user/user.model');

const pickPresentKeys = (body = {}, keys = []) =>
  keys.filter((key) => body[key] !== undefined && body[key] !== null && body[key] !== '');

const summarizeWinRequest = (req) => ({
  bet_id: req.body?.bet_id ?? null,
  betId: req.body?.betId ?? null,
  player_id: req.body?.player_id ?? null,
  playerId: req.body?.playerId ?? null,
  game_uuid: req.body?.game_uuid ?? null,
  gameUuid: req.body?.gameUuid ?? null,
  operator_reference_id: req.body?.operator_reference_id ?? null,
  operatorReferenceId: req.body?.operatorReferenceId ?? null,
  payout_fields: pickPresentKeys(req.body, [
    'payout_amount',
    'amount',
    'payout',
    'won_amount',
    'payoutAmount',
    'wonAmount',
    'win_amount',
    'winAmount',
  ]),
  payload_keys: Object.keys(req.body || {}).sort(),
  timestamp: req.headers['x-timestamp'] || null,
});

const summarizeWinPayoutValues = (body = {}) => ({
  payout_amount: body.payout_amount ?? null,
  amount: body.amount ?? null,
  payout: body.payout ?? null,
  won_amount: body.won_amount ?? null,
  payoutAmount: body.payoutAmount ?? null,
  wonAmount: body.wonAmount ?? null,
  win_amount: body.win_amount ?? null,
  winAmount: body.winAmount ?? null,
  nested_data_keys:
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? Object.keys(body.data).sort()
      : [],
  data_payout_amount: body.data?.payout_amount ?? null,
  data_amount: body.data?.amount ?? null,
  data_payout: body.data?.payout ?? null,
  data_won_amount: body.data?.won_amount ?? null,
  data_payoutAmount: body.data?.payoutAmount ?? null,
  data_wonAmount: body.data?.wonAmount ?? null,
  data_win_amount: body.data?.win_amount ?? null,
  data_winAmount: body.data?.winAmount ?? null,
});

const respondCallback = (res, out) => {
  const { _isDuplicate, ...body } = out;
  return res.status(200).json(body);
};

const playerInfo = async (req, res) => {
  try {
    return respondCallback(res, await service.playerInfo({ body: req.body }));
  } catch (e) {
    logger.error('EV /player_info error', e.message);
    return res.status(200).json(service.buildError(e.message));
  }
};

const bet = async (req, res) => {
  try {
    return respondCallback(res, await service.placeBet({ body: req.body }));
  } catch (e) {
    logger.error('EV /bet error', e.message);
    return res.status(200).json(service.buildError(e.message));
  }
};

const win = async (req, res) => {
  try {
    logger.info('EV /win received', summarizeWinRequest(req));
    logger.info('EV /win payout debug', summarizeWinPayoutValues(req.body));
    const out = await service.winBet({ body: req.body });
    logger.info('EV /win result', {
      bet_id: req.body?.bet_id ?? null,
      player_id: req.body?.player_id ?? null,
      status_code: out.status_code,
      status_description: out.status_description,
      balance: out.data?.balance ?? null,
      reference_id: out.data?.reference_id ?? null,
    });
    return respondCallback(res, out);
  } catch (e) {
    logger.error('EV /win error', e.message);
    return res.status(200).json(service.buildError(e.message));
  }
};

const rollback = async (req, res) => {
  try {
    return respondCallback(res, await service.rollbackBet({ body: req.body }));
  } catch (e) {
    logger.error('EV /rollback error', e.message);
    return res.status(200).json(service.buildError(e.message));
  }
};

const relay = (res, providerRes) => {
  if (!providerRes) return res.status(502).json({ status: false, message: 'provider_unreachable' });
  return res.status(providerRes.status || 502).json(providerRes.body || { raw: providerRes.raw });
};

const getGames = async (req, res) => {
  try {
    const { page, per_page, status, game_uuid } = req.query;
    const r = await client.listGames({ page, perPage: per_page, status, gameUuid: game_uuid });
    return relay(res, r);
  } catch (e) {
    logger.error('EV getGames error', e.message);
    return res.status(500).json({ status: false, message: e.message });
  }
};

const launch = async (req, res) => {
  try {
    const { game_uuid, demo } = req.body || {};
    if (!game_uuid) return res.status(400).json({ status: false, message: 'game_uuid required' });

    const user = await User.findById(req.user._id).lean();
    if (!user) return res.status(404).json({ status: false, message: 'user_not_found' });

    const isDemo = demo ? 1 : 0;
    const playerToken = isDemo ? null : await service.issueSession(user._id);

    const r = await client.launchGame({
      playerId: user._id,
      playerName: user.name || user.phone,
      playerToken,
      gameUuid: game_uuid,
      currency: config.eurovirtuals.currency,
      demo: isDemo,
    });
    return relay(res, r);
  } catch (e) {
    logger.error('EV launch error', e.message);
    return res.status(500).json({ status: false, message: e.message });
  }
};

const getBetStatus = async (req, res) => {
  try {
    const { game_uuid } = req.params;
    const { bet_id } = req.query;
    if (!bet_id) return res.status(400).json({ status: false, message: 'bet_id required' });
    const r = await client.getBetStatus({ gameUuid: game_uuid, betIds: bet_id });
    return relay(res, r);
  } catch (e) {
    logger.error('EV getBetStatus error', e.message);
    return res.status(500).json({ status: false, message: e.message });
  }
};

const shortcode = async (req, res) => {
  try {
    const { game_uuid } = req.params;
    const { player_id, player_name, currency, content, channel } = req.body || {};
    if (!player_id || !content) {
      return res.status(400).json({ status: false, message: 'player_id and content required' });
    }
    const r = await client.initiateShortcode({
      channel,
      gameUuid: game_uuid,
      playerId: player_id,
      playerName: player_name,
      currency: currency || config.eurovirtuals.currency,
      content,
    });
    return relay(res, r);
  } catch (e) {
    logger.error('EV shortcode error', e.message);
    return res.status(500).json({ status: false, message: e.message });
  }
};

module.exports = { playerInfo, bet, win, rollback, getGames, launch, getBetStatus, shortcode };
