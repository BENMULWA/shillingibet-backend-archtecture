'use strict';

const mongoose = require('mongoose');

const selectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    odds: { type: Number, required: true, min: 1.01 },
  },
  { _id: true }
);

const eventSchema = new mongoose.Schema(
  {
    sport: { type: String, required: true, index: true },
    league: { type: String, trim: true },
    homeTeam: { type: String, required: true, trim: true },
    awayTeam: { type: String, required: true, trim: true },
    startTime: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'finished', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    selections: { type: [selectionSchema], default: [] },
    result: { type: String, default: null },
  },
  { timestamps: true }
);

eventSchema.index({ sport: 1, startTime: 1, status: 1 });

module.exports = mongoose.model('Event', eventSchema);
