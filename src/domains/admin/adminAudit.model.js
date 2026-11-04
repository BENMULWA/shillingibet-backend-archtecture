'use strict';

const mongoose = require('mongoose');

const adminAuditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
    actorPhone: { type: String, required: true, immutable: true },
    actorRole: { type: String, required: true, immutable: true, index: true },
    action: { type: String, required: true, maxlength: 160, immutable: true, index: true },
    method: { type: String, required: true, maxlength: 10, immutable: true },
    path: { type: String, required: true, maxlength: 500, immutable: true },
    outcome: { type: String, enum: ['success', 'failed'], required: true, immutable: true, index: true },
    statusCode: { type: Number, required: true, immutable: true },
    ipAddress: { type: String, default: null, maxlength: 100, immutable: true },
    userAgent: { type: String, default: null, maxlength: 1000, immutable: true },
    details: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    category: { type: String, enum: ['write', 'read', 'export'], default: 'write', immutable: true, index: true },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true, index: true },
    reason: { type: String, default: null, maxlength: 500, immutable: true },
    changes: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  },
  { timestamps: true }
);

adminAuditSchema.index({ createdAt: -1 });
adminAuditSchema.index({ actor: 1, createdAt: -1 });
adminAuditSchema.index({ targetUser: 1, createdAt: -1 });
adminAuditSchema.index({ action: 1, outcome: 1, createdAt: -1 });

const rejectMutation = function rejectMutation() {
  throw new Error('Admin audit records are immutable');
};

adminAuditSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  rejectMutation
);

module.exports = mongoose.model('AdminAudit', adminAuditSchema);
