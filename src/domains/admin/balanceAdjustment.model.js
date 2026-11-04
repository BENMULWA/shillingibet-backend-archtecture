'use strict';

const mongoose = require('mongoose');

// Append-only ledger of manual balance changes made by staff.
const balanceAdjustmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['admin_credit', 'admin_zero_balance'], required: true, immutable: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
    amount: { type: Number, required: true, immutable: true },
    balanceBefore: { type: Number, required: true, immutable: true },
    balanceAfter: { type: Number, required: true, immutable: true },
    bonusBalanceBefore: { type: Number, required: true, immutable: true },
    bonusBalanceAfter: { type: Number, required: true, immutable: true },
    reason: { type: String, required: true, maxlength: 500, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

balanceAdjustmentSchema.index({ createdAt: -1 });

const rejectMutation = function rejectMutation() {
  throw new Error('Balance adjustment records are immutable');
};

balanceAdjustmentSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  rejectMutation
);

module.exports = mongoose.model('BalanceAdjustment', balanceAdjustmentSchema);
