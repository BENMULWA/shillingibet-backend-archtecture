'use strict';

const mongoose = require('mongoose');

const referralFraudEventSchema = new mongoose.Schema(
  {
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    award: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferralAward', required: true, index: true },
    riskScore: { type: Number, required: true, min: 0 },
    reasons: { type: [String], required: true },
    outcome: { type: String, enum: ['observed', 'held'], required: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReferralFraudEvent', referralFraudEventSchema);
