'use strict';

const config = require('../../config');
const logger = require('../../utils/logger');
const mamlaka = require('../../integrations/mamlaka/mamlaka.client');
const ProviderBalanceSnapshot = require('./providerBalance.model');

const kesOf = (data) => {
  const balances = data?.Balances || data?.balances || {};
  const value = Number(balances.kesBalance ?? balances.totalBalance);
  return Number.isFinite(value) ? value : null;
};

// Live balances at Mamlaka. Each side is read independently so one failure doesn't hide the other.
const readLiveBalances = async () => {
  const [payin, payout] = await Promise.allSettled([mamlaka.getPayinBalance(), mamlaka.getPayoutBalance()]);
  const errors = [payin, payout].filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  return {
    takenAt: new Date(),
    payinKes: payin.status === 'fulfilled' ? kesOf(payin.value) : null,
    payoutKes: payout.status === 'fulfilled' ? kesOf(payout.value) : null,
    error: errors.length ? errors.join('; ') : null,
  };
};

const recordSnapshot = async () => {
  const reading = await readLiveBalances();
  await ProviderBalanceSnapshot.create({ provider: 'mamlaka', ...reading });
  if (reading.error) logger.warn('Provider balance snapshot incomplete', reading.error);
  return reading;
};

// For each instant, the first good reading at or after it (within `maxLagMs`).
// Used as the balance "at" the start of a Nairobi day.
const readingAt = async (instant, maxLagMs = 2 * 60 * 60 * 1000) =>
  ProviderBalanceSnapshot.findOne({
    provider: 'mamlaka',
    takenAt: { $gte: instant, $lte: new Date(instant.getTime() + maxLagMs) },
    error: null,
  })
    .sort({ takenAt: 1 })
    .lean();

let timer;
const startProviderBalanceRecorder = () => {
  if (!config.providerSnapshots.enabled || timer) return;
  const everyMs = config.providerSnapshots.everyMinutes * 60 * 1000;
  const run = () => recordSnapshot().catch((error) => logger.warn('Provider balance snapshot failed', error.message));
  setTimeout(run, 20 * 1000).unref();
  timer = setInterval(run, everyMs);
  timer.unref();
  logger.info(`Recording provider balances every ${config.providerSnapshots.everyMinutes} min`);
};

module.exports = { readLiveBalances, recordSnapshot, readingAt, startProviderBalanceRecorder };
