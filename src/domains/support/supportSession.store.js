'use strict';

const { randomUUID } = require('crypto');
const SupportSession = require('./supportSession.model');
const notificationService = require('../notification/notification.service');

const toPublicSession = (session) => ({
  sessionId: session.sessionId,
  customer: session.customer,
  status: session.status,
  assignedAgentId: session.assignedAgentId ? String(session.assignedAgentId) : null,
  topic: session.topic,
  createdAt: session.createdAt,
  waitingStartedAt: session.waitingStartedAt,
  lastMessageAt: session.lastMessageAt,
  closedAt: session.closedAt || null,
});

const toPublicMessage = (message) => ({
  _id: message.messageId,
  senderId: message.senderId,
  senderType: message.senderType,
  senderUsername: message.senderUsername,
  content: message.content,
  messageType: message.messageType,
  replyTo: message.replyTo,
  clientId: message.clientId,
  createdAt: message.createdAt,
  readAt: message.readAt || null,
});

const serializeSession = (session) => ({
  ...toPublicSession(session),
  messages: (session.messages || []).map(toPublicMessage),
});

const listWaiting = () =>
  SupportSession.find({ status: 'waiting' }).sort({ waitingStartedAt: 1 }).lean();

const listAssigned = (agentId) =>
  SupportSession.find({ status: 'active', assignedAgentId: agentId })
    .sort({ lastMessageAt: -1 })
    .lean();

const listClosed = (agentId, limit = 100) =>
  SupportSession.find({ status: 'closed', assignedAgentId: agentId })
    .sort({ closedAt: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 100))
    .lean();

const getStats = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [todayChats, totalChats, queuedChats, activeChats] = await Promise.all([
    SupportSession.countDocuments({ createdAt: { $gte: today } }),
    SupportSession.countDocuments(),
    SupportSession.countDocuments({ status: 'waiting' }),
    SupportSession.countDocuments({ status: 'active' }),
  ]);
  return { todayChats, totalChats, queuedChats, activeChats };
};

const getOrCreateCustomerSession = async (user, topic) => {
  const customerId = user._id;
  let session = await SupportSession.findOne({
    customerId,
    open: true,
  }).sort({ updatedAt: -1 });

  if (session) return { session, created: false };

  const now = new Date();
  try {
    session = await SupportSession.create({
      sessionId: randomUUID(),
      customerId,
      customer: {
        _id: String(customerId),
        name: user.username || user.name || user.phone || '',
        email: user.email || '',
        phone: user.phone || '',
      },
      status: 'waiting',
      open: true,
      topic: String(topic || 'general').trim().slice(0, 50) || 'general',
      waitingStartedAt: now,
      lastMessageAt: now,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    session = await SupportSession.findOne({ customerId, open: true }).sort({ updatedAt: -1 });
    if (!session) throw error;
    return { session, created: false };
  }
  await notificationService.create({
    type: 'support_waiting',
    severity: 'info',
    title: 'New support chat waiting',
    message: `${session.customer?.name || session.customer?.phone || 'A customer'} started a new support chat.`,
    relatedId: session._id,
  });
  return { session, created: true };
};

const appendMessage = async (sessionId, message, owner = {}) => {
  const stored = {
    messageId: message._id,
    senderId: String(message.senderId),
    senderType: message.senderType,
    senderUsername: message.senderUsername || '',
    content: message.content,
    messageType: message.messageType || 'text',
    replyTo: message.replyTo || null,
    clientId: message.clientId || null,
    createdAt: message.createdAt,
  };
  const filter = { sessionId, status: { $ne: 'closed' } };
  if (owner.agentId) {
    filter.status = 'active';
    filter.assignedAgentId = owner.agentId;
  }
  if (owner.customerId) filter.customerId = owner.customerId;

  return SupportSession.findOneAndUpdate(
    filter,
    {
      $push: { messages: { $each: [stored], $slice: -500 } },
      $set: { lastMessageAt: message.createdAt },
    },
    { new: true }
  ).lean();
};

// An agent has seen the customer's messages: stamp every unread one with the time.
// Returns the ids that changed (or null when there was nothing new to mark).
const markCustomerMessagesRead = async (sessionId, agentId) => {
  const session = await SupportSession.findOne({ sessionId, status: 'active', assignedAgentId: agentId }).lean();
  if (!session) return null;

  const messageIds = (session.messages || [])
    .filter((message) => message.senderType === 'customer' && !message.readAt)
    .map((message) => message.messageId);
  if (!messageIds.length) return null;

  const readAt = new Date();
  await SupportSession.updateOne(
    { sessionId },
    { $set: { 'messages.$[m].readAt': readAt } },
    { arrayFilters: [{ 'm.senderType': 'customer', 'm.readAt': null }] }
  );
  return { sessionId, messageIds, readAt: readAt.toISOString() };
};

const claimSession = (sessionId, agentId) =>
  SupportSession.findOneAndUpdate(
    { sessionId, status: 'waiting' },
    { $set: { status: 'active', assignedAgentId: agentId } },
    { new: true }
  ).lean();

const findAssignedSession = (sessionId, agentId) =>
  SupportSession.findOne({ sessionId, status: 'active', assignedAgentId: agentId }).lean();

const findClosedSession = (sessionId, agentId) =>
  SupportSession.findOne({ sessionId, status: 'closed', assignedAgentId: agentId }).lean();

const closeSession = (sessionId, agentId) =>
  SupportSession.findOneAndUpdate(
    { sessionId, status: 'active', assignedAgentId: agentId },
    { $set: { status: 'closed', open: false, closedAt: new Date() } },
    { new: true }
  ).lean();

const transferSession = (sessionId, fromAgentId, toAgentId, reason = '') => {
  const now = new Date();
  return SupportSession.findOneAndUpdate(
    { sessionId, status: 'active', assignedAgentId: fromAgentId },
    {
      $set: { assignedAgentId: toAgentId, lastMessageAt: now },
      $push: {
        messages: {
          $each: [{
            messageId: randomUUID(),
            senderId: String(fromAgentId),
            senderType: 'system',
            senderUsername: 'System',
            content: reason
              ? `Chat transferred to another support agent. Reason: ${String(reason).trim().slice(0, 500)}`
              : 'Chat transferred to another support agent.',
            messageType: 'system',
            createdAt: now,
          }],
          $slice: -500,
        },
      },
    },
    { new: true }
  ).lean();
};

const deleteMessage = (sessionId, agentId, messageId) =>
  SupportSession.findOneAndUpdate(
    { sessionId, status: 'active', assignedAgentId: agentId },
    { $pull: { messages: { messageId } } },
    { new: true }
  ).lean();

module.exports = {
  appendMessage,
  claimSession,
  closeSession,
  deleteMessage,
  findAssignedSession,
  findClosedSession,
  getStats,
  getOrCreateCustomerSession,
  listAssigned,
  listClosed,
  listWaiting,
  markCustomerMessagesRead,
  transferSession,
  serializeSession,
  toPublicMessage,
  toPublicSession,
};
