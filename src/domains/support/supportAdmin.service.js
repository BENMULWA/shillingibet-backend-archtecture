'use strict';

const mongoose = require('mongoose');
const ApiError = require('../../utils/ApiError');
const User = require('../user/user.model');
const SupportSession = require('./supportSession.model');
const supportStore = require('./supportSession.store');
const presence = require('./supportPresence');

const listOnlineAgents = async (currentUserId) => {
  const agents = presence
    .list()
    .filter((agent) => agent.status === 'online' && String(agent.userId) !== String(currentUserId));
  const ids = agents.map((agent) => agent.userId);
  const activeCounts = ids.length ? await SupportSession.aggregate([
    { $match: { status: 'active', assignedAgentId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$assignedAgentId', count: { $sum: 1 } } },
  ]) : [];
  const countMap = new Map(activeCounts.map((row) => [String(row._id), row.count]));
  return {
    agents: agents.map((agent) => ({
      userId: String(agent.userId),
      username: agent.name,
      status: agent.status,
      currentChats: countMap.get(String(agent.userId)) || 0,
    })),
  };
};

const listAgents = async ({ status }) => {
  const filter = { isStaff: true, deletedAt: null };
  if (status) filter.status = status === 'banned' ? 'suspended' : status;
  const users = await User.find(filter)
    .select('phone name adminLevel status createdAt')
    .sort({ createdAt: -1 })
    .lean();
  const metrics = await SupportSession.aggregate([
    { $match: { assignedAgentId: { $ne: null } } },
    { $group: { _id: '$assignedAgentId', totalChatsHandled: { $sum: 1 } } },
  ]);
  const metricMap = new Map(metrics.map((row) => [String(row._id), row.totalChatsHandled]));
  return {
    agents: users.map((user) => ({
      _id: user._id,
      userId: String(user._id),
      accountId: String(user._id),
      username: user.name || user.phone,
      role: user.adminLevel,
      status: user.status,
      onlineStatus: presence.get(user._id)?.status || 'offline',
      metrics: {
        totalChatsHandled: metricMap.get(String(user._id)) || 0,
        totalRatingsSum: 0,
        ratingsCount: 0,
      },
    })),
  };
};

const setAgentBan = async (actor, userId, { ban }) => {
  if (String(actor._id) === String(userId)) {
    throw ApiError.badRequest('You cannot suspend your own account');
  }
  const user = await User.findOneAndUpdate(
    { _id: userId, isStaff: true, deletedAt: null },
    { $set: { status: ban ? 'suspended' : 'active' } },
    { new: true, runValidators: true }
  ).lean();
  if (!user) throw ApiError.notFound('Support agent not found');
  if (ban) presence.remove(userId);
  return user;
};

const listSessions = async ({ status, limit }) => {
  const rows = await SupportSession.find(status ? { status } : {})
    .populate('assignedAgentId', 'name phone')
    .sort({ lastMessageAt: -1 })
    .limit(limit)
    .lean();
  return {
    sessions: rows.map((session) => ({
      ...supportStore.toPublicSession(session),
      messageCount: session.messages?.length || 0,
      assignedAgentId: session.assignedAgentId ? {
        _id: session.assignedAgentId._id,
        name: session.assignedAgentId.name || session.assignedAgentId.phone,
      } : null,
    })),
  };
};

const getSession = async (sessionId) => {
  const session = await SupportSession.findOne({ sessionId }).lean();
  if (!session) throw ApiError.notFound('Support session not found');
  return {
    session: supportStore.toPublicSession(session),
    messages: (session.messages || []).map(supportStore.toPublicMessage),
  };
};

module.exports = {
  getSession,
  listAgents,
  listOnlineAgents,
  listSessions,
  setAgentBan,
};
