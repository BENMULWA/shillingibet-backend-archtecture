'use strict';

const AuthEvent = require('./authEvent.model');
const logger = require('../../utils/logger');

const maskPhone = (phone) => {
  const digits = String(phone || '');
  return digits ? `******${digits.slice(-4)}` : null;
};

const contextFromRequest = (req) => ({
  ip: req.ip || null,
  userAgent: req.get('user-agent') || null,
});

// Best-effort: a failure to record must never block (or reveal anything about) the auth flow.
const record = async ({ type, outcome, user = null, phone = null, context = {}, detail = null }) => {
  try {
    await AuthEvent.create({
      type,
      outcome,
      user: user?._id || user || null,
      maskedPhone: maskPhone(phone || user?.phone),
      ipAddress: context.ip || null,
      userAgent: context.userAgent ? String(context.userAgent).slice(0, 1000) : null,
      detail: detail ? String(detail).slice(0, 300) : null,
    });
  } catch (error) {
    logger.error('Failed to persist auth event', type, error.message);
  }
};

const toPublicEvent = (item) => ({
  _id: item._id,
  type: item.type,
  outcome: item.outcome,
  userId: item.user ? String(item.user) : null,
  maskedPhone: item.maskedPhone,
  ipAddress: item.ipAddress,
  userAgent: item.userAgent,
  detail: item.detail,
  timestamp: item.createdAt,
});

const list = async ({ page = 1, limit = 20, type, outcome } = {}) => {
  const filter = {};
  if (type) filter.type = type;
  if (outcome) filter.outcome = outcome;
  const [rows, total] = await Promise.all([
    AuthEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuthEvent.countDocuments(filter),
  ]);
  return { events: rows.map(toPublicEvent), page, limit, total, totalPages: Math.ceil(total / limit) };
};

module.exports = { record, list, maskPhone, contextFromRequest };
