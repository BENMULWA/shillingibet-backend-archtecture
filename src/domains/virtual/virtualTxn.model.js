'use strict';

const mongoose = require('mongoose');

const virtualTxnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    betId: { type: String, required: true, index: true },
    providerTransactionId: { type: String, default: null, index: true },
    action: {
      type: String,
      enum: ['place_bet', 'result_bet', 'result_freebet', 'rollback_bet'],
      required: true,
    },
    type: { type: String, default: null },
    gameUuid: { type: String, default: null },
    gameName: { type: String, default: null },
    currency: { type: String, required: true },
    amount: { type: Number, default: 0 },
    payout: { type: Number, default: 0 },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    referenceId: { type: String, required: true, unique: true },
    operatorReferenceId: { type: String, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

virtualTxnSchema.index({ betId: 1, action: 1 }, { unique: true });

module.exports = mongoose.model('VirtualTxn', virtualTxnSchema);
