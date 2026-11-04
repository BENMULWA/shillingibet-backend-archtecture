'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const mamlaka = require('../../integrations/mamlaka/mamlaka.client');
const smsService = require('../../services/sms.service');
const notificationService = require('../notification/notification.service');
const PayoutFloat = require('./payoutFloat.model');

const FLOAT_ID = 'payout-float';
const MIN_GAP_BETWEEN_CHECKS_MS = 60 * 1000;

let lastCheckAt = 0;
let timer = null;

const money = (value) => Number(value).toLocaleString('en-KE', { maximumFractionDigits: 2 });

// The real KES available at the payment provider for paying players out.
const readProviderBalance = async () => {
  const data = await mamlaka.getPayoutBalance();
  const balances = data?.Balances || data?.balances || {};
  const value = Number(balances.kesBalance ?? balances.totalBalance);
  return Number.isFinite(value) ? value : null;
};

// Only one alert per cooldown window, even across restarts: the claim is a single atomic update.
const claimAlertSlot = async (now) => {
  const cooldownMs = config.liquidity.cooldownMinutes * 60 * 1000;
  await PayoutFloat.updateOne({ _id: FLOAT_ID }, { $setOnInsert: { _id: FLOAT_ID } }, { upsert: true }).catch(() => {});
  const claim = await PayoutFloat.findOneAndUpdate(
    {
      _id: FLOAT_ID,
      $or: [
        { lastLiquidityAlertAt: null },
        { lastLiquidityAlertAt: { $exists: false } },
        { lastLiquidityAlertAt: { $lte: new Date(now.getTime() - cooldownMs) } },
      ],
    },
    { $set: { lastLiquidityAlertAt: now } },
    { new: true }
  ).lean();
  return Boolean(claim);
};

const checkLiquidity = async ({ force = false } = {}) => {
  const now = new Date();
  if (!force && now.getTime() - lastCheckAt < MIN_GAP_BETWEEN_CHECKS_MS) return { skipped: true };
  lastCheckAt = now.getTime();

  let balance;
  try {
    balance = await readProviderBalance();
  } catch (error) {
    logger.warn('Liquidity check could not read the payout balance', error.message);
    return { checked: false };
  }
  if (balance == null) {
    logger.warn('Liquidity check: payout balance missing from the provider reply');
    return { checked: false };
  }

  const { threshold, alertPhones } = config.liquidity;
  if (balance >= threshold) return { checked: true, balance, low: false };

  const slotClaimed = await claimAlertSlot(now);
  if (!slotClaimed) return { checked: true, balance, low: true, alerted: false };

  const message = `Bingwake ALERT: payout balance is KES ${money(balance)}, below the KES ${money(threshold)} limit. Fund the master wallet so players can keep withdrawing.`;
  await Promise.all(
    alertPhones.map((phone) => smsService.safeSend({ phone, message, context: 'liquidity_low' }))
  );
  await notificationService.create({
    type: 'treasury_low',
    severity: 'critical',
    title: 'Payout balance is low',
    message,
    dedupeKey: 'liquidity-low',
    cooldownMs: config.liquidity.cooldownMinutes * 60 * 1000,
  });
  logger.warn('Liquidity alert sent', balance, threshold);
  return { checked: true, balance, low: true, alerted: true };
};

// Fire-and-forget from request paths: never slows down or fails a withdrawal.
const checkSoon = (options) => {
  if (!config.liquidity.monitorEnabled) return;
  checkLiquidity(options).catch((error) => logger.warn('Liquidity check failed', error.message));
};

const startLiquidityMonitor = () => {
  if (!config.liquidity.monitorEnabled || timer) return;
  const everyMs = config.liquidity.checkMinutes * 60 * 1000;
  setTimeout(() => checkSoon({ force: true }), 30 * 1000).unref();
  timer = setInterval(() => checkSoon({ force: true }), everyMs);
  timer.unref();
  logger.info(`Liquidity monitor on: every ${config.liquidity.checkMinutes} min, alert below KES ${config.liquidity.threshold}`);
};

module.exports = { checkLiquidity, checkSoon, startLiquidityMonitor, readProviderBalance };
