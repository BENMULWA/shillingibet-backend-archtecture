'use strict';

const Notification = require('./notification.model');
const logger = require('../../utils/logger');

// Cooldown so a repeatedly-failing condition (e.g. treasury staying low across
// many withdrawal attempts) doesn't spam one notification per event.
const DEDUPE_COOLDOWN_MS = 30 * 60 * 1000;

const create = async ({ type, severity = 'info', title, message, relatedId = null, dedupeKey = null }) => {
  try {
    if (dedupeKey) {
      const recentDuplicate = await Notification.findOne({
        dedupeKey,
        createdAt: { $gte: new Date(Date.now() - DEDUPE_COOLDOWN_MS) },
      }).lean();
      if (recentDuplicate) return null;
    }
    return await Notification.create({ type, severity, title, message, relatedId, dedupeKey });
  } catch (err) {
    // Notifications are best-effort side effects — never let a failure here
    // break the actual business operation that triggered it.
    logger.error('Failed to create notification', type, err.message);
    return null;
  }
};

const list = async ({ page = 1, limit = 20, unreadOnly = false } = {}) => {
  const filter = unreadOnly ? { read: false } : {};
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ read: false }),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit), unreadCount };
};

const markRead = (id) =>
  Notification.updateOne({ _id: id }, { $set: { read: true, readAt: new Date() } });

const markAllRead = () =>
  Notification.updateMany({ read: false }, { $set: { read: true, readAt: new Date() } });

module.exports = { create, list, markRead, markAllRead };
