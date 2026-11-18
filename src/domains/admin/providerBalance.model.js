'use strict';

const mongoose = require('mongoose');

// Hourly reading of the real money held at the payment provider (Mamlaka), so the
// finance report can show opening and closing balances per day for reconciliation.
const providerBalanceSnapshotSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, default: 'mamlaka', immutable: true },
    takenAt: { type: Date, required: true, immutable: true, index: true },
    payinKes: { type: Number, default: null, immutable: true }, // collections (paybill) account
    payoutKes: { type: Number, default: null, immutable: true }, // disbursement account
    error: { type: String, default: null, immutable: true },
  },
  { timestamps: false }
);

providerBalanceSnapshotSchema.index({ provider: 1, takenAt: 1 });

module.exports = mongoose.model('ProviderBalanceSnapshot', providerBalanceSnapshotSchema);
