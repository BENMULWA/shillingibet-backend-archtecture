'use strict';

const mongoose = require('mongoose');

const cashbackAwardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
    windowStart: { type: Date, required: true, immutable: true, index: true },
    windowEnd: { type: Date, required: true, immutable: true, index: true },
    sportsbookStake: { type: Number, required: true, default: 0, immutable: true },
    sportsbookPayout: { type: Number, required: true, default: 0, immutable: true },
    virtualStake: { type: Number, required: true, default: 0, immutable: true },
    virtualPayout: { type: Number, required: true, default: 0, immutable: true },
    netLoss: { type: Number, required: true, min: 0, immutable: true },
    rate: { type: Number, required: true, min: 0, max: 1, immutable: true },
    amount: { type: Number, required: true, min: 0.01, immutable: true },
    currency: { type: String, required: true, default: 'KES', immutable: true },
    creditKey: { type: String, required: true, unique: true, immutable: true },
    creditedAt: { type: Date, required: true, immutable: true },
  },
  { timestamps: true }
);

cashbackAwardSchema.index({ user: 1, windowEnd: 1 }, { unique: true });

const rejectMutation = function rejectMutation() {
  throw new Error('Cashback awards are immutable');
};

cashbackAwardSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  rejectMutation
);

module.exports = mongoose.model('CashbackAward', cashbackAwardSchema);
