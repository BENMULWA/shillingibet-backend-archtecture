'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['treasury_low', 'fraud_alert', 'large_transaction', 'support_waiting', 'generic'],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true,
    },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, required: true, maxlength: 500 },
    relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },
    dedupeKey: { type: String, default: null, index: true },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
