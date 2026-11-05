'use strict';

const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true },
    senderId: { type: String, required: true },
    senderType: { type: String, enum: ['customer', 'agent', 'system'], required: true },
    senderUsername: { type: String, trim: true, maxlength: 120, default: '' },
    content: { type: String, required: true, maxlength: 1000 },
    messageType: { type: String, trim: true, maxlength: 30, default: 'text' },
    replyTo: { type: mongoose.Schema.Types.Mixed, default: null },
    clientId: { type: String, default: null },
    createdAt: { type: Date, required: true, default: Date.now },
    // When a support agent saw this customer message (null until then).
    readAt: { type: Date, default: null },
  },
  { _id: false }
);

const supportSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customer: {
      _id: { type: String, required: true },
      name: { type: String, trim: true, maxlength: 120, default: '' },
      email: { type: String, trim: true, maxlength: 254, default: '' },
      phone: { type: String, trim: true, maxlength: 30, default: '' },
    },
    status: {
      type: String,
      enum: ['waiting', 'active', 'closed'],
      required: true,
      default: 'waiting',
      index: true,
    },
    open: { type: Boolean, required: true, default: true, index: true },
    assignedAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    topic: { type: String, trim: true, maxlength: 50, default: 'general' },
    messages: { type: [supportMessageSchema], default: [] },
    waitingStartedAt: { type: Date, required: true, default: Date.now },
    lastMessageAt: { type: Date, required: true, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

supportSessionSchema.index({ status: 1, waitingStartedAt: 1 });
supportSessionSchema.index({ assignedAgentId: 1, status: 1, lastMessageAt: -1 });
supportSessionSchema.index({ customerId: 1, status: 1, updatedAt: -1 });
supportSessionSchema.index(
  { customerId: 1, open: 1 },
  { unique: true, partialFilterExpression: { open: true } }
);

module.exports = mongoose.model('SupportSession', supportSessionSchema);
