'use strict';

const mongoose = require('mongoose');

const freeBetAuditSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['campaign_create', 'campaign_status', 'award_create', 'award_revoke'],
      required: true,
      immutable: true,
      index: true,
    },
    outcome: {
      type: String,
      enum: ['success', 'failed'],
      required: true,
      immutable: true,
      index: true,
    },
    requestId: { type: String, required: true, unique: true, immutable: true, index: true },
    campaignId: { type: String, default: null, immutable: true, index: true },
    freeBetId: { type: String, default: null, immutable: true, index: true },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', immutable: true }],
    request: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    providerStatus: { type: Number, default: null, immutable: true, index: true },
    providerDescription: { type: String, default: null, maxlength: 500, immutable: true },
    result: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  },
  { timestamps: true }
);

freeBetAuditSchema.index({ action: 1, outcome: 1, createdAt: -1 });
freeBetAuditSchema.index({ campaignId: 1, createdAt: -1 });

const rejectMutation = function rejectMutation() {
  throw new Error('Free-bet audit records are immutable');
};

freeBetAuditSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  rejectMutation
);

module.exports = mongoose.model('FreeBetAudit', freeBetAuditSchema);
