'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const { createSignature } = require('./eurovirtuals.signature');

const { baseUrl, apiKey, appKey, returnUrl } = config.eurovirtuals;

const timestamp = () => Math.floor(Date.now() / 1000).toString();

const signedHeaders = (signaturePayload) => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'x-signature-key': createSignature(signaturePayload, appKey),
  'x-timestamp': timestamp(),
});

const send = async (method, path, { body, sign } = {}) => {
  const headers = signedHeaders(sign || body || {});
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw };
  }

  if (!res.ok) {
    logger.error('EuroVirtuals request failed', path, res.status, raw.slice(0, 300));
  }

  return { status: res.status, body: parsed, raw };
};

const listGames = ({ page, perPage, status, gameUuid } = {}) => {
  const sign = {};
  if (page) sign.page = String(page);
  if (perPage) sign.per_page = String(perPage);
  if (status) sign.status = String(status);
  if (gameUuid) sign.game_uuid = String(gameUuid);
  const qs = new URLSearchParams(sign).toString();
  return send('GET', `/v1/games${qs ? `?${qs}` : ''}`, { sign });
};

const launchGame = ({ playerId, playerName, playerToken, gameUuid, currency, demo }) => {
  const body = demo
    ? { game_uuid: gameUuid, currency, demo: 1, return_url: returnUrl }
    : {
        player_id: String(playerId),
        player_name: playerName,
        player_token: playerToken,
        game_uuid: gameUuid,
        currency,
        demo: 0,
        return_url: returnUrl,
      };
  return send('POST', '/v1/launch', { body });
};

const getBetStatus = ({ gameUuid, betIds }) =>
  send('GET', `/v1/bet/status/${gameUuid}?bet_id=${encodeURIComponent(betIds)}`, {
    sign: { bet_id: String(betIds) },
  });

const initiateShortcode = ({ channel = 'ussd', gameUuid, playerId, playerName, currency, content }) => {
  const path = channel === 'sms' ? 'sms' : 'ussd';
  return send('POST', `/v1/${path}/session/${gameUuid}`, {
    body: {
      player_id: String(playerId),
      player_name: playerName,
      currency,
      content,
    },
  });
};

const createFreeBetCampaign = (body) =>
  send('POST', '/v1/freebet/campaigns', { body });

const listFreeBetCampaigns = ({ gameUuid, status, page, perPage } = {}) => {
  const sign = {};
  if (gameUuid) sign.game_uuid = String(gameUuid);
  if (status) sign.status = String(status);
  if (page) sign.page = String(page);
  if (perPage) sign.per_page = String(perPage);
  const qs = new URLSearchParams(sign).toString();
  return send('GET', `/v1/freebet/campaigns${qs ? `?${qs}` : ''}`, { sign });
};

const getFreeBetCampaign = (campaignId) =>
  send('GET', `/v1/freebet/campaigns/${encodeURIComponent(campaignId)}`, { sign: {} });

const updateFreeBetCampaignStatus = (campaignId, body) =>
  send('PATCH', `/v1/freebet/campaigns/${encodeURIComponent(campaignId)}/status`, { body });

const awardFreeBets = (campaignId, body) =>
  send('POST', `/v1/freebet/campaigns/${encodeURIComponent(campaignId)}/awards`, { body });

const listFreeBetAwards = ({ campaignId, playerId, status, page, perPage } = {}) => {
  const sign = {};
  if (campaignId) sign.campaign_id = String(campaignId);
  if (playerId) sign.player_id = String(playerId);
  if (status) sign.status = String(status);
  if (page) sign.page = String(page);
  if (perPage) sign.per_page = String(perPage);
  const qs = new URLSearchParams(sign).toString();
  return send('GET', `/v1/freebet/awards${qs ? `?${qs}` : ''}`, { sign });
};

const revokeFreeBet = (freeBetId, body) =>
  send('POST', `/v1/freebet/awards/${encodeURIComponent(freeBetId)}/revoke`, { body });

module.exports = {
  listGames,
  launchGame,
  getBetStatus,
  initiateShortcode,
  createFreeBetCampaign,
  listFreeBetCampaigns,
  getFreeBetCampaign,
  updateFreeBetCampaignStatus,
  awardFreeBets,
  listFreeBetAwards,
  revokeFreeBet,
};

