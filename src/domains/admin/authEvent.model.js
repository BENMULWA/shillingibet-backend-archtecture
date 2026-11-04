'use strict';

const mongoose = require('mongoose');

const authEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      immutable: true,
      index: true,
      enum: [
        'staff_login_password_failed',
        'staff_login_not_staff',
        'staff_login_code_sent',
        'staff_login_code_failed',
        'staff_login_success',
        'staff_blocked_player_login',
        'password_reset_requested',
        'password_reset_failed',
        'password_reset_success',
        'staff_access_denied',
      ],
    },
    outcome: { type: String, enum: ['success', 'failed', 'denied'], required: true, immutable: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true, index: true },
    maskedPhone: { type: String, default: null, immutable: true },
    ipAddress: { type: String, default: null, maxlength: 100, immutable: true },
    userAgent: { type: String, default: null, maxlength: 1000, immutable: true },
    detail: { type: String, default: null, maxlength: 300, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

authEventSchema.index({ createdAt: -1 });
authEventSchema.index({ type: 1, createdAt: -1 });
authEventSchema.index({ user: 1, createdAt: -1 });

const rejectMutation = function rejectMutation() {
  throw new Error('Auth event records are immutable');
};

authEventSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  rejectMutation
);

module.exports = mongoose.model('AuthEvent', authEventSchema);
