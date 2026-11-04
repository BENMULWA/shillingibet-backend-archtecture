'use strict';

const AdminAudit = require('./adminAudit.model');

const toPublicLog = (item) => ({
  _id: item._id,
  userId: String(item.actor),
  actorPhone: item.actorPhone,
  actorRole: item.actorRole,
  action: item.action,
  outcome: item.outcome,
  statusCode: item.statusCode,
  ipAddress: item.ipAddress,
  userAgent: item.userAgent,
  category: item.category || 'write',
  targetUserId: item.targetUser ? String(item.targetUser) : null,
  reason: item.reason || null,
  changes: item.changes || null,
  details: { method: item.method, path: item.path, statusCode: item.statusCode, request: item.details },
  timestamp: item.createdAt,
});

const buildFilter = ({ action, category, outcome, actor, targetUser, dateFrom, dateTo } = {}) => {
  const filter = {};
  if (action) filter.action = action;
  if (category) filter.category = category;
  if (outcome) filter.outcome = outcome;
  if (actor) filter.actor = actor;
  if (targetUser) filter.targetUser = targetUser;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = dateFrom;
    if (dateTo) filter.createdAt.$lte = dateTo;
  }
  return filter;
};

const pageResult = async (filter, { page = 1, limit = 20 }) => {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    AdminAudit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminAudit.countDocuments(filter),
  ]);
  return { logs: rows.map(toPublicLog), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const list = (query) => pageResult(buildFilter(query), query);
// Everything a staff member did, plus everything done to that user.
const byUser = (userId, query) => pageResult({ ...buildFilter(query), $or: [{ actor: userId }, { targetUser: userId }] }, query);

const byDate = async (date) => {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const rows = await AdminAudit.find({ createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).lean();
  return { date, count: rows.length, logs: rows.map(toPublicLog) };
};

const dates = async () => {
  const values = await AdminAudit.aggregate([
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } } } },
    { $sort: { _id: -1 } },
  ]);
  return { dates: values.map((value) => value._id), count: values.length };
};

const stats = async () => {
  const [totalLogs, actionRows, userRows, outcomeRows, categoryRows] = await Promise.all([
    AdminAudit.countDocuments(),
    AdminAudit.aggregate([{ $group: { _id: '$action', count: { $sum: 1 } } }]),
    AdminAudit.aggregate([{ $group: { _id: '$actor', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }]),
    AdminAudit.aggregate([{ $group: { _id: '$outcome', count: { $sum: 1 } } }]),
    AdminAudit.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);
  return {
    totalLogs,
    actionCounts: Object.fromEntries(actionRows.map((row) => [row._id, row.count])),
    userCounts: Object.fromEntries(userRows.map((row) => [String(row._id), row.count])),
    categoryCounts: Object.fromEntries(categoryRows.map((row) => [row._id || 'write', row.count])),
    outcomeCounts: Object.fromEntries(outcomeRows.map((row) => [row._id, row.count])),
  };
};

module.exports = { list, byUser, byDate, dates, stats };
