'use strict';

const mongoose = require('mongoose');

// Gateway watchdog (see gatewayWatch.service.js).
// Readings: the Mamlaka pay-in and payout balances, taken every minute and kept 14 days.
const gatewayReadingSchema = new mongoose.Schema(
  {
    takenAt: { type: Date, required: true, index: true },
    payinKes: { type: Number, default: null },
    payoutKes: { type: Number, default: null },
    error: { type: String, default: null },
    // Filled when the reading is compared with the one before it.
    previousAt: { type: Date, default: null },
    actualChange: { type: Number, default: null }, // change in pay-in + payout
    expectedChange: { type: Number, default: null }, // our deposits in - our payouts out
    unexplained: { type: Number, default: null }, // actual - expected, after fee allowance
  },
  { timestamps: false }
);
gatewayReadingSchema.index({ takenAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60, name: 'reading_ttl' });

// One alert per incident or re-alert: money left the gateway that Bingwake did not send,
// or Mamlaka reported a transaction Bingwake never created.
const gatewayAlertSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['unexplained_outflow', 'unknown_callback', 'rejected_callback'], required: true },
    amount: { type: Number, default: 0 }, // KES unexplained (positive number)
    windowMinutes: { type: Number, default: null },
    fromAt: { type: Date, default: null },
    toAt: { type: Date, default: null },
    balancesBefore: { payinKes: Number, payoutKes: Number },
    balancesAfter: { payinKes: Number, payoutKes: Number },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    dedupeKey: { type: String, default: null, index: true },
    holdApplied: { type: Boolean, default: false },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgeReason: { type: String, default: null },
  },
  { timestamps: true }
);

// Single document holding the watchdog's state: the open incident and the withdrawal hold.
const gatewayWatchStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'mamlaka' },
    lastTickAt: { type: Date, default: null },
    breachStreak: { type: Number, default: 0 },
    incident: {
      open: { type: Boolean, default: false },
      openedAt: { type: Date, default: null },
      totalLost: { type: Number, default: 0 },
      lastAlertAt: { type: Date, default: null },
      lastAlertReadingAt: { type: Date, default: null },
    },
    hold: {
      active: { type: Boolean, default: false },
      since: { type: Date, default: null },
      reason: { type: String, default: null },
      by: { type: String, default: null }, // 'watchdog' or the staff user id
    },
    lastUnknownCallbackSmsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = {
  GatewayReading: mongoose.model('GatewayReading', gatewayReadingSchema),
  GatewayAlert: mongoose.model('GatewayAlert', gatewayAlertSchema),
  GatewayWatchState: mongoose.model('GatewayWatchState', gatewayWatchStateSchema),
};
