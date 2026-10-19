'use strict';

const mongoose = require('mongoose');

const betSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    selectionKey: { type: String, required: true },
    selectionLabel: { type: String, required: true },
    odds: { type: Number, required: true, min: 1.01 },
    stake: { type: Number, required: true, min: 1 },
    potentialPayout: { type: Number, required: true },
    walletType: { type: String, enum: ['balance', 'airtime'], default: 'balance', index: true },
    status: {
      type: String,
      enum: ['open', 'won', 'lost', 'void'],
      default: 'open',
      index: true,
    },
    settledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

betSchema.index({ event: 1, status: 1 });

module.exports = mongoose.model('Bet', betSchema);
