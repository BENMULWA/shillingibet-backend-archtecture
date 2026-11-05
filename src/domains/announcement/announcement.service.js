'use strict';

const ApiError = require('../../utils/ApiError');
const Announcement = require('./announcement.model');
const { broadcastAnnouncement } = require('../../realtime/supportChat');

// What players (and the admin list) get to see: no internal fields.
const toPublic = (doc) => ({
  id: String(doc._id),
  title: doc.title || '',
  message: doc.message,
  author: doc.createdByName || 'Bingwake',
  createdAt: doc.createdAt,
});

const list = async ({ limit = 20 } = {}) => {
  const rows = await Announcement.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map(toPublic);
};

const create = async (actor, { title = '', message }) => {
  const doc = await Announcement.create({
    title,
    message,
    createdBy: actor._id,
    createdByName: actor.name || 'Bingwake team',
  });
  const announcement = toPublic(doc);
  broadcastAnnouncement('announcement:new', announcement);
  return announcement;
};

const remove = async (id) => {
  const doc = await Announcement.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { new: true }
  ).lean();
  if (!doc) throw ApiError.notFound('Announcement not found');
  broadcastAnnouncement('announcement:removed', { id: String(doc._id) });
  return toPublic(doc);
};

module.exports = { list, create, remove, toPublic };
