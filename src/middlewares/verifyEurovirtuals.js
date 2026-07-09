'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const { generateToken, createSignature, safeEqual } = require('../integrations/eurovirtuals/eurovirtuals.signature');

const unauthorized = (res) =>
  res.status(200).json({ status_code: 401, status_description: 'Unauthorised access' });
const reconcileInFlight = new Set();

const pickPresentKeys = (body = {}, keys = []) =>
  keys.filter((key) => body[key] !== undefined && body[key] !== null && body[key] !== '');

const callbackDebugMeta = (req) => ({
  path: req.originalUrl,
  bet_id: req.body?.bet_id || null,
  betId: req.body?.betId || null,
  player_id: req.body?.player_id || null,
  playerId: req.body?.playerId || null,
  timestamp: req.headers['x-timestamp'] || null,
  body_keys: Object.keys(req.body || {}).sort(),
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
});

const triggerAutoReconcile = (req, reason) => {
  if (req.originalUrl !== `${config.apiPrefix}/virtuals/win`) return;

  const betId = req.body?.bet_id;
  const gameUuid = req.body?.game_uuid;
  if (!betId) return;
  if (reconcileInFlight.has(betId)) return;

  reconcileInFlight.add(betId);

  setImmediate(async () => {
    try {
      const virtualService = require('../domains/virtual/virtual.service');
      const result = await virtualService.reconcileBetStatus({ betId, gameUuid });
      logger.info('EV auto reconcile finished', {
        reason,
        bet_id: betId,
        game_uuid: gameUuid || null,
        ok: Boolean(result?.ok),
        reconciled: Boolean(result?.reconciled),
        idempotent: Boolean(result?.idempotent),
        reconcile_reason: result?.reason || null,
      });
    } catch (err) {
      logger.error('EV auto reconcile failed', betId, err.message);
    } finally {
      reconcileInFlight.delete(betId);
    }
  });
};

module.exports = (req, res, next) => {
  if (!config.eurovirtuals.verifyCallbacks) return next();

  const tokenKey = req.headers['x-token-key'];
  const signatureKey = req.headers['x-signature-key'];
  const ts = req.headers['x-timestamp'];

  if (!tokenKey || !signatureKey || !ts) {
    logger.warn('EV callback missing auth headers', {
      ...callbackDebugMeta(req),
      has_token_key: Boolean(tokenKey),
      has_signature_key: Boolean(signatureKey),
      has_timestamp: Boolean(ts),
    });
    triggerAutoReconcile(req, 'missing_auth_headers');
    return unauthorized(res);
  }

  const expectedToken = generateToken(config.eurovirtuals.appKey, ts);
  if (!safeEqual(expectedToken, tokenKey)) {
    logger.warn('EV callback token mismatch', {
      ...callbackDebugMeta(req),
    });
    triggerAutoReconcile(req, 'token_mismatch');
    return unauthorized(res);
  }

  const expectedAppKeySignature = createSignature(req.body || {}, config.eurovirtuals.appKey);
  const expectedTokenSignature = createSignature(req.body || {}, tokenKey);
  const signatureUsesAppKey = safeEqual(expectedAppKeySignature, signatureKey);
  const signatureUsesTokenKey = safeEqual(expectedTokenSignature, signatureKey);

  if (!signatureUsesAppKey && !signatureUsesTokenKey) {
    logger.warn('EV callback signature mismatch', {
      ...callbackDebugMeta(req),
    });
    triggerAutoReconcile(req, 'signature_mismatch');
    return unauthorized(res);
  }

  if (signatureUsesTokenKey && !signatureUsesAppKey) {
    logger.info('EV callback accepted with legacy token-key signature', callbackDebugMeta(req));
  }

  next();
};
