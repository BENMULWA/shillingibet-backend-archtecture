'use strict';

const mongoose = require('mongoose');

const virtualSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    // The wallet this game session plays with, fixed when the game is opened.
    walletType: { type: String, enum: ['balance', 'airtime'], default: 'balance' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

virtualSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('VirtualSession', virtualSessionSchema);
