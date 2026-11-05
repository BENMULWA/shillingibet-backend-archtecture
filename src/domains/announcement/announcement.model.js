'use strict';

const mongoose = require('mongoose');

// A message from the Bingwake team to all players (not a chat: players cannot reply).
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 80, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, trim: true, maxlength: 120, default: '' },
    // Removing an announcement hides it but keeps the record.
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

announcementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
