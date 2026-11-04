'use strict';

const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const payoutFloatSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'payout-float' },
    balance: { type: Number, default: 0, min: 0 },
    totalAllocated: { type: Number, default: 0, min: 0 },
    allocationKeys: { type: [String], default: [] },
    reservations: { type: [reservationSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastLowBalanceAlertAt: { type: Date, default: null },
    lastLiquidityAlertAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PayoutFloat', payoutFloatSchema);