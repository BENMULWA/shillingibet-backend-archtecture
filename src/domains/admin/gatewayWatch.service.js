'use strict';

// GATEWAY WATCHDOG: alerts when money leaves the Mamlaka account that Bingwake did not send.
//
// Why: on 20 Nov 2026 about KES 51,500 was paid out of the shilingibet merchant straight
// through the Mamlaka API. Mamlaka sent the payment notices to the address the caller chose
// (webhook.site), so Bingwake never heard of those payouts. Bingwake can't list Mamlaka's
// transactions, but it can read the two balances, so it watches those instead.
//
// How it works:
//  1. Every minute, read the Mamlaka pay-in and payout balances and store the reading.
//  2. Over the last 10 minutes and the last hour, compare how much the total (pay-in + payout)
//     changed with what our own records explain:
//        expected change = our completed deposits in - our completed payouts out
//        unexplained     = actual change - expected change
//     A small allowance per transaction covers provider charges on our own transactions.
//     Money moved between pay-in and payout cancels out, because only the total is compared.
//  3. If more than KES 100 (10 min) or KES 300 (1 hour) is unexplained, minus anything our
//     still-pending withdrawals could explain, and it is still unexplained on the next
//     reading, raise an alert:
//        - SMS to GATEWAY_ALERT_PHONES and a critical dashboard notification
//        - M-Pesa withdrawals are paused (GATEWAY_WATCH_AUTO_HOLD, on by default)
//  4. While the incident is open, each further KES 100 that leaves unexplained sends another alert.
//  5. A super admin reviews it on the Gateway monitor page: acknowledges it with a reason and
//     chooses whether to resume withdrawals. Both are recorded in the admin audit log.
//  6. If Mamlaka ever sends a notice for a transaction Bingwake didn't create, that is an alert
//     too (no automatic pause, since anyone can call the public callback address).
//  7. When MAMLAKA_CALLBACK_IPS is set, callbacks from any other address are refused and listed
//     here (middlewares/callbackIpAllowlist.js).

const config = require('../../config');
const logger = require('../../utils/logger');
const smsService = require('../../services/sms.service');
const notificationService = require('../notification/notification.service');
const Transaction = require('../transaction/transaction.model');
const { payoutAmountOf } = require('../transaction/withdrawalCharges');
const { readLiveBalances } = require('./providerBalance.service');
const { GatewayReading, GatewayAlert, GatewayWatchState } = require('./gatewayWatch.model');

const STATE_ID = 'mamlaka';
const NOT_MAMLAKA = /^(comet|celo|transactpay)$/i;
const CONFIRM_STREAK = 2; // readings in a row that must show the loss before alerting

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const totalOf = (r) => (r && r.payinKes != null && r.payoutKes != null ? r.payinKes + r.payoutKes : null);

// ---------- pure calculations (unit tested) ----------

// What our own completed transactions explain. Mamlaka pays withdrawals in whole shillings.
const summarizeMovements = (txns, cfg = config.gatewayWatch) => {
  let deposits = 0;
  let payouts = 0;
  let count = 0;
  for (const t of txns) {
    if (t.type === 'deposit') deposits += Number(t.amount) || 0;
    else if (t.type === 'withdrawal') payouts += Math.floor((Number(payoutAmountOf(t)) || 0) + 1e-9);
    else continue;
    count += 1;
  }
  return {
    deposits: round2(deposits),
    payouts: round2(payouts),
    count,
    expectedChange: round2(deposits - payouts),
    allowance: round2(count * cfg.feePerTxnKes + cfg.feeRate * (deposits + payouts)),
  };
};

// Negative = money left that our records don't explain. Positive = unexplained money in (e.g. a top-up).
const unexplainedChange = (before, after, movements) => {
  const actual = round2(totalOf(after) - totalOf(before));
  const raw = actual - movements.expectedChange;
  const unexplained = raw < 0 ? Math.min(0, raw + movements.allowance) : raw;
  return { actual, expected: movements.expectedChange, unexplained: round2(unexplained) };
};

// The worst window whose unexplained loss, after what pending withdrawals could still explain,
// reaches its threshold. Returns null when nothing does.
const worstBreach = (windows, pendingCover = 0) => {
  let worst = null;
  for (const w of windows) {
    if (w.unexplained == null) continue;
    const loss = round2(-w.unexplained - pendingCover);
    if (loss >= w.threshold && (!worst || loss > worst.loss)) worst = { ...w, loss };
  }
  return worst;
};

// ---------- database helpers ----------

const ensureState = async () => {
  await GatewayWatchState.updateOne({ _id: STATE_ID }, { $setOnInsert: { _id: STATE_ID } }, { upsert: true }).catch(() => {});
  return GatewayWatchState.findById(STATE_ID).lean();
};

const goodReading = { error: null, payinKes: { $ne: null }, payoutKes: { $ne: null } };

const readingAtOrBefore = (at) =>
  GatewayReading.findOne({ ...goodReading, takenAt: { $lte: at } }).sort({ takenAt: -1 }).lean();

const movementsBetween = async (from, to) =>
  summarizeMovements(
    await Transaction.find({
      status: 'completed',
      type: { $in: ['deposit', 'withdrawal'] },
      provider: { $not: NOT_MAMLAKA },
      completedAt: { $gt: from, $lte: to },
    })
      .select('type amount netAmount currency')
      .lean()
  );

// Withdrawals we sent that Mamlaka may already have paid but not yet confirmed to us.
const pendingPayoutCover = async (now) => {
  const pending = await Transaction.find({
    type: 'withdrawal',
    status: 'pending',
    provider: { $not: NOT_MAMLAKA },
    createdAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
  })
    .select('type amount netAmount')
    .lean();
  return summarizeMovements(pending).payouts;
};

const notifyPhones = async (message, context) =>
  Promise.all(config.gatewayWatch.alertPhones.map((phone) => smsService.safeSend({ phone, message, context })));

// ---------- withdrawal hold ----------

let holdCache = { at: 0, active: false };
const isWithdrawalHoldActive = async () => {
  if (Date.now() - holdCache.at < 10 * 1000) return holdCache.active;
  try {
    const state = await GatewayWatchState.findById(STATE_ID).select('hold').lean();
    holdCache = { at: Date.now(), active: Boolean(state?.hold?.active) };
  } catch (error) {
    logger.warn('Gateway hold check failed', error.message);
  }
  return holdCache.active;
};

const setHold = async ({ active, reason, by }) => {
  await ensureState();
  const hold = active
    ? { active: true, since: new Date(), reason: reason || null, by: by ? String(by) : null }
    : { active: false, since: null, reason: null, by: null };
  await GatewayWatchState.updateOne({ _id: STATE_ID }, { $set: { hold } });
  holdCache = { at: 0, active: false };
  return hold;
};

// ---------- alerts ----------

const raiseOutflowAlert = async ({ loss, windowMinutes, before, after, state }) => {
  const { autoHold } = config.gatewayWatch;
  const holdNow = autoHold && !state?.hold?.active;
  const alert = await GatewayAlert.create({
    kind: 'unexplained_outflow',
    amount: loss,
    windowMinutes,
    fromAt: before.takenAt,
    toAt: after.takenAt,
    balancesBefore: { payinKes: before.payinKes, payoutKes: before.payoutKes },
    balancesAfter: { payinKes: after.payinKes, payoutKes: after.payoutKes },
    holdApplied: holdNow,
  });
  if (holdNow) await setHold({ active: true, reason: `Unexplained outflow of KES ${money(loss)}`, by: 'watchdog' });

  const paused = autoHold ? ' M-Pesa withdrawals are paused.' : '';
  const message =
    `Bingwake ALERT: KES ${money(loss)} left the Mamlaka account in ${windowMinutes} min that Bingwake did not send. ` +
    `Now pay-in ${money(after.payinKes)}, payout ${money(after.payoutKes)}.${paused} Check Gateway monitor.`;
  await notifyPhones(message, 'gateway_outflow');
  await notificationService.create({
    type: 'fraud_alert',
    severity: 'critical',
    title: 'Money left the Mamlaka account unexplained',
    message,
    dedupeKey: `gateway-outflow-${alert._id}`,
  });
  logger.error('Gateway watchdog alert', { loss, windowMinutes, payin: after.payinKes, payout: after.payoutKes });
  return alert;
};

// Called when Mamlaka reports a transaction Bingwake never created.
const reportUnknownCallback = async (payload = {}) => {
  try {
    const clip = (v) => (v == null ? null : String(v).slice(0, 80));
    const details = {
      externalId: clip(payload.externalId),
      secureId: clip(payload.secureId),
      amount: Number(payload.amount) || null,
      currency: clip(payload.currency),
      status: clip(payload.transactionStatus || payload.status),
      report: clip(payload.transactionReport),
    };
    const dedupeKey = `unknown-callback-${details.externalId}`;
    if (await GatewayAlert.exists({ dedupeKey })) return;
    await GatewayAlert.create({ kind: 'unknown_callback', amount: details.amount || 0, details, dedupeKey });

    const message = `Bingwake ALERT: Mamlaka reported a ${details.report || 'transaction'} of KES ${money(details.amount || 0)} (${details.status || 'unknown status'}, ref ${details.externalId}) that Bingwake never created.`;
    await notificationService.create({ type: 'fraud_alert', severity: 'critical', title: 'Unknown Mamlaka transaction', message, dedupeKey });

    // One SMS per cooldown at most: the callback address is public and could be spammed.
    await ensureState();
    const cooldownMs = config.gatewayWatch.unknownCallbackSmsCooldownMinutes * 60 * 1000;
    const now = new Date();
    const claimed = await GatewayWatchState.findOneAndUpdate(
      { _id: STATE_ID, $or: [{ lastUnknownCallbackSmsAt: null }, { lastUnknownCallbackSmsAt: { $lte: new Date(now - cooldownMs) } }] },
      { $set: { lastUnknownCallbackSmsAt: now } }
    ).lean();
    if (claimed) await notifyPhones(message, 'gateway_unknown_callback');
  } catch (error) {
    logger.warn('Could not record unknown callback alert', error.message);
  }
};

// Called when a callback arrives from an address outside MAMLAKA_CALLBACK_IPS.
// One record and dashboard notice per address per hour; no SMS (anyone can trigger this).
const reportRejectedCallback = async ({ ip, provider, path }) => {
  try {
    const hour = new Date().toISOString().slice(0, 13);
    const dedupeKey = `rejected-callback-${ip}-${hour}`;
    if (await GatewayAlert.exists({ dedupeKey })) return;
    await GatewayAlert.create({ kind: 'rejected_callback', amount: 0, details: { ip, provider, path }, dedupeKey });
    await notificationService.create({
      type: 'fraud_alert',
      severity: 'warning',
      title: `${provider} callback refused`,
      message: `A ${provider} payment notice to ${path} came from ${ip}, which is not on the allowed list. It was refused.`,
      dedupeKey,
    });
  } catch (error) {
    logger.warn('Could not record refused callback', error.message);
  }
};

// ---------- the check ----------

const tick = async ({ force = false } = {}) => {
  const cfg = config.gatewayWatch;
  const now = new Date();
  await ensureState();
  // One check at a time across processes.
  const minGapMs = force ? 5 * 1000 : cfg.everySeconds * 1000 * 0.8;
  const state = await GatewayWatchState.findOneAndUpdate(
    { _id: STATE_ID, $or: [{ lastTickAt: null }, { lastTickAt: { $lte: new Date(now - minGapMs) } }] },
    { $set: { lastTickAt: now } },
    { new: true }
  ).lean();
  if (!state) return { skipped: true };

  const live = await readLiveBalances();
  const previous = await readingAtOrBefore(now);
  const reading = { takenAt: live.takenAt, payinKes: live.payinKes, payoutKes: live.payoutKes, error: live.error };
  const ok = totalOf(reading) != null && !reading.error;

  if (ok && previous) {
    const interval = unexplainedChange(previous, reading, await movementsBetween(previous.takenAt, reading.takenAt));
    Object.assign(reading, {
      previousAt: previous.takenAt,
      actualChange: interval.actual,
      expectedChange: interval.expected,
      unexplained: interval.unexplained,
    });
  }
  await GatewayReading.create(reading);
  if (!ok) {
    logger.warn('Gateway watchdog could not read Mamlaka balances', reading.error);
    return { checked: false, error: reading.error };
  }

  const windows = [];
  for (const [minutes, threshold] of [[cfg.windowMinutes, cfg.thresholdKes], [60, cfg.hourThresholdKes]]) {
    const before = await readingAtOrBefore(new Date(now - minutes * 60 * 1000));
    if (!before || now - before.takenAt > 2 * minutes * 60 * 1000) continue;
    const change = unexplainedChange(before, reading, await movementsBetween(before.takenAt, reading.takenAt));
    windows.push({ minutes, threshold, before, ...change });
  }
  const pendingCover = await pendingPayoutCover(now);
  const breach = worstBreach(windows, pendingCover);

  if (!breach) {
    await GatewayWatchState.updateOne({ _id: STATE_ID }, { $set: { breachStreak: 0 } });
    return { checked: true, reading, breach: null };
  }

  const streak = (state.breachStreak || 0) + 1;
  await GatewayWatchState.updateOne({ _id: STATE_ID }, { $set: { breachStreak: streak } });
  if (streak < CONFIRM_STREAK) return { checked: true, reading, breach, confirming: true };

  if (!state.incident?.open) {
    await raiseOutflowAlert({ loss: breach.loss, windowMinutes: breach.minutes, before: breach.before, after: reading, state });
    await GatewayWatchState.updateOne(
      { _id: STATE_ID },
      { $set: { incident: { open: true, openedAt: now, totalLost: breach.loss, lastAlertAt: now, lastAlertReadingAt: reading.takenAt } } }
    );
    return { checked: true, reading, breach, alerted: true };
  }

  // Incident already open: alert again only for new money lost since the last alert.
  const lastAlertReading = await readingAtOrBefore(state.incident.lastAlertReadingAt);
  if (!lastAlertReading) return { checked: true, reading, breach };
  const since = unexplainedChange(lastAlertReading, reading, await movementsBetween(lastAlertReading.takenAt, reading.takenAt));
  const newLoss = round2(-since.unexplained - pendingCover);
  if (newLoss < cfg.thresholdKes) return { checked: true, reading, breach };

  const minutes = Math.max(1, Math.round((reading.takenAt - lastAlertReading.takenAt) / 60000));
  await raiseOutflowAlert({ loss: newLoss, windowMinutes: minutes, before: lastAlertReading, after: reading, state });
  await GatewayWatchState.updateOne(
    { _id: STATE_ID },
    {
      $set: { 'incident.lastAlertAt': now, 'incident.lastAlertReadingAt': reading.takenAt },
      $inc: { 'incident.totalLost': newLoss },
    }
  );
  return { checked: true, reading, breach, alerted: true };
};

// ---------- review (super admin) ----------

const acknowledge = async ({ actorId, reason, resumeWithdrawals }) => {
  const now = new Date();
  await ensureState();
  const { modifiedCount } = await GatewayAlert.updateMany(
    { acknowledgedAt: null },
    { $set: { acknowledgedAt: now, acknowledgedBy: actorId, acknowledgeReason: reason } }
  );
  await GatewayWatchState.updateOne(
    { _id: STATE_ID },
    { $set: { breachStreak: 0, incident: { open: false, openedAt: null, totalLost: 0, lastAlertAt: null, lastAlertReadingAt: null } } }
  );
  if (resumeWithdrawals) await setHold({ active: false });
  return { acknowledgedAlerts: modifiedCount, withdrawalsResumed: Boolean(resumeWithdrawals) };
};

const getStatus = async ({ hours = 24 } = {}) => {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const [state, latest, readings, alerts, movements] = await Promise.all([
    ensureState(),
    GatewayReading.findOne(goodReading).sort({ takenAt: -1 }).lean(),
    GatewayReading.find({ ...goodReading, takenAt: { $gte: since } }).sort({ takenAt: 1 }).select('takenAt payinKes payoutKes').lean(),
    GatewayAlert.find().sort({ createdAt: -1 }).limit(50).lean(),
    GatewayReading.find({ takenAt: { $gte: since }, $or: [{ unexplained: { $lte: -1 } }, { unexplained: { $gte: 1 } }] })
      .sort({ takenAt: -1 })
      .limit(100)
      .lean(),
  ]);
  const step = Math.max(1, Math.ceil(readings.length / 300));
  return {
    enabled: config.gatewayWatch.enabled,
    settings: {
      everySeconds: config.gatewayWatch.everySeconds,
      thresholdKes: config.gatewayWatch.thresholdKes,
      windowMinutes: config.gatewayWatch.windowMinutes,
      hourThresholdKes: config.gatewayWatch.hourThresholdKes,
      autoHold: config.gatewayWatch.autoHold,
    },
    lastCheckAt: state?.lastTickAt || null,
    latest: latest ? { takenAt: latest.takenAt, payinKes: latest.payinKes, payoutKes: latest.payoutKes } : null,
    incident: state?.incident || { open: false },
    hold: state?.hold || { active: false },
    series: readings.filter((_, i) => i % step === 0 || i === readings.length - 1),
    movements: movements.map((m) => ({
      takenAt: m.takenAt,
      previousAt: m.previousAt,
      actualChange: m.actualChange,
      expectedChange: m.expectedChange,
      unexplained: m.unexplained,
      payinKes: m.payinKes,
      payoutKes: m.payoutKes,
    })),
    alerts,
  };
};

let timer;
const startGatewayWatch = () => {
  if (!config.gatewayWatch.enabled || timer) return;
  const run = () => tick().catch((error) => logger.warn('Gateway watchdog check failed', error.message));
  setTimeout(run, 15 * 1000).unref();
  timer = setInterval(run, config.gatewayWatch.everySeconds * 1000);
  timer.unref();
  logger.info(
    `Gateway watchdog on: every ${config.gatewayWatch.everySeconds}s, alert at KES ${config.gatewayWatch.thresholdKes}/${config.gatewayWatch.windowMinutes} min or KES ${config.gatewayWatch.hourThresholdKes}/hour`
  );
};

module.exports = {
  summarizeMovements,
  unexplainedChange,
  worstBreach,
  tick,
  acknowledge,
  setHold,
  getStatus,
  isWithdrawalHoldActive,
  reportUnknownCallback,
  reportRejectedCallback,
  startGatewayWatch,
};
