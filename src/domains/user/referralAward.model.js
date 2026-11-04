'use strict';

const mongoose = require('mongoose');

const referralAwardSchema = new mongoose.Schema(
  {
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      immutable: true,
      index: true,
    },
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0.01, immutable: true },
    currency: { type: String, required: true, default: 'KES', immutable: true },
    status: { type: String, enum: ['credited', 'held', 'rejected'], required: true, index: true },
    riskScore: { type: Number, required: true, min: 0, immutable: true },
    reasons: { type: [String], default: [], immutable: true },
    creditedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNotes: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

const rejectMutation = function rejectMutation() {
  throw new Error('Referral awards are immutable');
};

referralAwardSchema.pre(
  ['deleteOne', 'deleteMany', 'findOneAndDelete'],
  rejectMutation
);

module.exports = mongoose.model('ReferralAward', referralAwardSchema);
