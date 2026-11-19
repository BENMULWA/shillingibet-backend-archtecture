'use strict';

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['deposit', 'withdrawal'], required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'expired'],
      default: 'pending',
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    // Cash withdrawals: `amount` is debited from the wallet, `netAmount` is paid out,
    // `taxAmount` + `feeAmount` are kept by the platform. Null on deposits and airtime.
    taxRate: { type: Number, default: null },
    taxAmount: { type: Number, default: null, min: 0 },
    feeAmount: { type: Number, default: null, min: 0 },
    // Cents left after rounding the payout down to whole shillings (M-Pesa pays whole KES).
    roundingAmount: { type: Number, default: null, min: 0 },
    netAmount: { type: Number, default: null, min: 0 },
    currency: { type: String, required: true, default: 'KES' },
    walletType: { type: String, enum: ['balance', 'airtime'], default: 'balance', index: true },
    provider: { type: String, required: true },
    phone: { type: String, required: true },
    externalId: { type: String, required: true, unique: true, index: true },
    secureId: { type: String, default: null, index: true },
    receipt: { type: String, default: null },
    failureReason: { type: String, default: null },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    rawCallback: { type: mongoose.Schema.Types.Mixed, default: null },
    completedAt: { type: Date, default: null },
    walletAppliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, type: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
