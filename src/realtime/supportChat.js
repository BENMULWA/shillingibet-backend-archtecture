'use strict';

const { Server } = require('socket.io');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const User = require('../domains/user/user.model');
const supportStore = require('../domains/support/supportSession.store');
const supportAdminService = require('../domains/support/supportAdmin.service');
const supportPresence = require('../domains/support/supportPresence');
const { getStaffLevel, isStaffUser } = require('../middlewares/auth');

const cleanToken = (value) => String(value || '').replace(/^Bearer\s+/i, '').trim();

const onAsync = (socket, event, handler) => {
  socket.on(event, (...args) => {
    Promise.resolve(handler(...args)).catch((error) => {
      logger.error(`Support chat ${event} failed: ${error.message}`);
      socket.emit('agent:error', { message: 'Unable to complete chat request' });
    });
  });
};

const authenticateSocket = async (socket, next) => {
  try {
    const token = cleanToken(socket.handshake.auth?.token);
    if (!token) return next(new Error('Authentication token missing'));

    const payload = jwt.verify(token, config.jwt.secret);
    const user = await User.findById(payload.sub).lean();

    if (!user) return next(new Error('User no longer exists'));
    if (user.status !== 'active') return next(new Error('Account is suspended'));
    if (user.phoneVerified !== true) return next(new Error('Phone number not verified'));
    socket.data.user = user;
    // Staff privileges only apply to tokens from the SMS-verified staff sign-in.
    socket.data.staffLevel = isStaffUser(user) && payload.mfa === true ? getStaffLevel(user) : null;
    return next();
  } catch (error) {
    logger.warn(`Support chat authentication failed: ${error.message}`);
    return next(new Error('Authentication failed'));
  }
};

const attachSupportChat = (httpServer) => {
  const { credentials } = config.cors;
  const io = new Server(httpServer, {
    cors: {
      // Same as the REST API (src/middlewares/cors.js): any origin, access is decided by the JWT.
      origin: true,
      credentials,
      methods: ['GET', 'POST'],
    },
    transports: ['polling', 'websocket'],
  });

  const namespace = io.of('/support-chat');
  const community = io.of('/community-chat');
  let activeCustomers = 0;

  namespace.use(authenticateSocket);
  community.use(authenticateSocket);

  const communityMessages = [];
  let communityUsers = 0;

  community.on('connection', (socket) => {
    communityUsers += 1;
    const userId = String(socket.data.user._id);
    const username = socket.data.user.username || socket.data.user.name || socket.data.user.phone;

    socket.emit('chat:history', {
      user: socket.data.user,
      messages: communityMessages,
      activeUsers: communityUsers,
    });
    socket.broadcast.emit('chat:user_joined', { username, activeUsers: communityUsers });

    socket.on(
      'chat:send_message',
      ({ content, messageType = 'text', replyTo = null, clientId = null } = {}) => {
      const normalizedContent = String(content || '').trim().slice(0, 1000);
      if (!normalizedContent) return;
      const message = {
        _id: randomUUID(),
        senderId: userId,
        senderType: 'customer',
        senderUsername: username,
        content: normalizedContent,
        messageType,
        replyTo,
        clientId,
        createdAt: new Date().toISOString(),
      };
      communityMessages.push(message);
      if (communityMessages.length > 100) communityMessages.shift();
      community.emit('chat:new_message', message);
      },
    );

    socket.on('chat:typing', () => {
      socket.broadcast.emit('chat:user_typing', { username });
    });
    socket.on('chat:stop_typing', () => {
      socket.broadcast.emit('chat:user_stop_typing', { username });
    });
    socket.on('disconnect', () => {
      communityUsers = Math.max(0, communityUsers - 1);
      socket.broadcast.emit('chat:user_left', { username, activeUsers: communityUsers });
    });
  });

  const emitQueue = async () => {
    const sessions = await supportStore.listWaiting();
    namespace.to('staff').emit('agent:queue', {
      queue: sessions.map(supportStore.toPublicSession),
    });
  };
  const emitStats = async (target = namespace.to('staff')) => {
    const stats = await supportStore.getStats();
    target.emit('agent:stats', {
      stats: {
        ...stats,
        onlineAgents: supportPresence.count(),
      },
    });
  };
  const makeMessage = ({
    senderId,
    senderType,
    senderUsername,
    content,
    messageType,
    replyTo,
    clientId,
  }) => ({
    _id: randomUUID(),
    senderId,
    senderType,
    senderUsername,
    content: String(content || '').trim().slice(0, 1000),
    messageType: messageType || 'text',
    replyTo: replyTo || null,
    clientId: clientId || null,
    createdAt: new Date().toISOString(),
  });

  // Tell the customer (and any other viewer) which of their messages an agent has now seen.
  const emitRead = async (sessionId, agentId) => {
    const receipt = await supportStore.markCustomerMessagesRead(sessionId, agentId);
    if (receipt) namespace.to(`session:${sessionId}`).emit('chat:read', receipt);
  };

  namespace.on('connection', async (socket) => {
    const userId = String(socket.data.user._id);

    if (!socket.data.staffLevel) {
      let result;
      try {
        result = await supportStore.getOrCreateCustomerSession(
          socket.data.user,
          socket.handshake.auth?.topic
        );
      } catch (error) {
        logger.error(`Unable to create support session: ${error.message}`);
        socket.emit('chat:error', { message: 'Unable to start support chat' });
        socket.disconnect(true);
        return;
      }

      activeCustomers += 1;
      const { session } = result;
      const username = socket.data.user.username || socket.data.user.name || socket.data.user.phone;

      socket.data.sessionId = session.sessionId;
      socket.join(`session:${session.sessionId}`);
      socket.emit('chat:history', {
        user: socket.data.user,
        messages: (session.messages || []).map(supportStore.toPublicMessage),
        activeUsers: activeCustomers,
      });
      socket.broadcast.emit('chat:user_joined', { username, activeUsers: activeCustomers });

      if (result.created) {
        namespace.to('staff').emit('agent:new_chat_waiting', {
          session: supportStore.toPublicSession(session),
        });
        await Promise.all([emitQueue(), emitStats()]);
      }

      onAsync(
        socket,
        'chat:send_message',
        async ({ content, messageType = 'text', replyTo = null, clientId = null } = {}) => {
        const message = makeMessage({
          senderId: userId,
          senderType: 'customer',
          senderUsername: username,
          content,
          messageType,
          replyTo,
          clientId,
        });
        if (!message.content) return;

        const updated = await supportStore.appendMessage(session.sessionId, message, {
          customerId: userId,
        });
        if (!updated) {
          socket.emit('chat:error', { message: 'This support chat is closed' });
          return;
        }
        namespace.to(`session:${session.sessionId}`).emit('chat:new_message', message);
        namespace.to('staff').emit('agent:customer_message', {
          sessionId: session.sessionId,
          message,
        });
        },
      );

      socket.on('chat:typing', () => {
        socket.to(`session:${session.sessionId}`).emit('chat:typing', {
          sessionId: session.sessionId,
          userType: 'customer',
          username,
        });
      });
      socket.on('chat:stop_typing', () => {
        socket.to(`session:${session.sessionId}`).emit('chat:stop_typing', {
          sessionId: session.sessionId,
          userType: 'customer',
          username,
        });
      });
      socket.on('disconnect', () => {
        activeCustomers = Math.max(0, activeCustomers - 1);
        socket.broadcast.emit('chat:user_left', { username, activeUsers: activeCustomers });
      });
      return;
    }

    socket.join('staff');
    socket.join(`staff:${userId}`);

    onAsync(socket, 'agent:go_online', async () => {
      socket.data.agentStatus = 'online';
      supportPresence.setOnline(userId, {
        userId,
        name: socket.data.user.name || socket.data.user.phone,
        status: 'online',
      });
      const [waiting, assigned, history] = await Promise.all([
        supportStore.listWaiting(),
        supportStore.listAssigned(userId),
        supportStore.listClosed(userId),
      ]);
      socket.emit('agent:online_confirmed', {
        queue: waiting.map(supportStore.toPublicSession),
        activeChats: assigned.map(supportStore.toPublicSession),
        history: history.map(supportStore.toPublicSession),
      });
      socket.emit('agent:status_confirmed', { status: 'online' });
      await emitStats();
    });

    onAsync(socket, 'agent:get_stats', async () => {
      const [waiting, assigned, history] = await Promise.all([
        supportStore.listWaiting(),
        supportStore.listAssigned(userId),
        supportStore.listClosed(userId),
      ]);
      socket.emit('agent:queue', { queue: waiting.map(supportStore.toPublicSession) });
      socket.emit('agent:active_chats', {
        chats: assigned.map(supportStore.toPublicSession),
      });
      socket.emit('agent:history', {
        chats: history.map(supportStore.toPublicSession),
      });
      socket.emit('agent:status_confirmed', {
        status: socket.data.agentStatus || 'offline',
      });
      await emitStats(socket);
    });

    socket.on('agent:go_away', () => {
      socket.data.agentStatus = 'away';
      supportPresence.setStatus(userId, 'away');
      socket.emit('agent:status_confirmed', { status: 'away' });
      void emitStats();
    });

    socket.on('agent:go_offline', () => {
      socket.data.agentStatus = 'offline';
      supportPresence.remove(userId);
      socket.emit('agent:status_confirmed', { status: 'offline' });
      void emitStats();
    });

    onAsync(socket, 'agent:accept_chat', async ({ sessionId } = {}) => {
      const session = await supportStore.claimSession(sessionId, userId);
      if (!session) {
        socket.emit('agent:error', { message: 'Chat is no longer available' });
        return;
      }

      socket.join(`session:${sessionId}`);
      socket.emit('agent:chat_accepted', {
        session: supportStore.toPublicSession(session),
        messages: (session.messages || []).map(supportStore.toPublicMessage),
      });
      socket.to('staff').emit('agent:chat_taken', { sessionId });
      namespace.to(`session:${sessionId}`).emit('chat:assigned', {
        sessionId,
        agent: { name: socket.data.user.name || socket.data.user.phone },
      });
      await emitRead(sessionId, userId);
      await Promise.all([emitQueue(), emitStats()]);
    });

    onAsync(socket, 'agent:join_chat', async ({ sessionId } = {}) => {
      const session = await supportStore.findAssignedSession(sessionId, userId);
      if (!session) {
        socket.emit('agent:error', { message: 'Chat is not assigned to this agent' });
        return;
      }
      socket.join(`session:${sessionId}`);
      socket.emit('agent:chat_joined', {
        session: supportStore.toPublicSession(session),
        messages: (session.messages || []).map(supportStore.toPublicMessage),
      });
      await emitRead(sessionId, userId);
    });

    // The agent's screen shows the chat and a new customer message just arrived.
    onAsync(socket, 'agent:mark_read', async ({ sessionId } = {}) => {
      await emitRead(sessionId, userId);
    });

    onAsync(socket, 'agent:transfer_chat', async ({ sessionId, toAgentId, reason } = {}) => {
      const targetId = String(toAgentId || '');
      if (!targetId || targetId === userId) {
        socket.emit('agent:error', { message: 'Select another support agent' });
        return;
      }
      const target = supportPresence.get(targetId);
      if (!target || target.status !== 'online') {
        socket.emit('agent:error', { message: 'The selected support agent is no longer online' });
        return;
      }

      const session = await supportStore.transferSession(sessionId, userId, targetId, reason);
      if (!session) {
        socket.emit('agent:error', { message: 'Chat is no longer assigned to you' });
        return;
      }

      const publicSession = supportStore.toPublicSession(session);
      namespace.to(`staff:${userId}`).emit('agent:chat_transferred', { sessionId });
      namespace.in(`staff:${userId}`).socketsLeave(`session:${sessionId}`);
      namespace.to(`staff:${targetId}`).emit('agent:chat_transferred_to_you', {
        session: publicSession,
      });
      namespace.to(`session:${sessionId}`).emit('chat:assigned', {
        sessionId,
        agent: { name: target.name },
        transferred: true,
      });
      await emitStats();
    });

    onAsync(socket, 'agent:view_history', async ({ sessionId } = {}) => {
      const session = await supportStore.findClosedSession(sessionId, userId);
      if (!session) {
        socket.emit('agent:error', { message: 'Chat history is not available' });
        return;
      }
      socket.emit('agent:history_opened', {
        session: supportStore.toPublicSession(session),
        messages: (session.messages || []).map(supportStore.toPublicMessage),
      });
    });

    onAsync(socket, 'admin:view_chat', async ({ sessionId } = {}) => {
      if (socket.data.staffLevel !== 'super_admin') {
        socket.emit('agent:error', { message: 'Super admin access required' });
        return;
      }
      const session = await supportAdminService.getSession(sessionId);
      socket.join(`session:${sessionId}`);
      socket.emit('admin:chat_joined', session);
    });

    onAsync(socket, 'agent:send_message', async ({ sessionId, content, tempId } = {}) => {
      const message = makeMessage({
        senderId: userId,
        senderType: 'agent',
        senderUsername: socket.data.user.name || 'Support',
        content,
      });
      if (!message.content) return;

      const updated = await supportStore.appendMessage(sessionId, message, { agentId: userId });
      if (!updated) return;
      socket.to(`session:${sessionId}`).emit('chat:new_message', message);
      socket.emit('agent:message_sent', { tempId, messageId: message._id });
      await emitRead(sessionId, userId);
    });

    socket.on('agent:typing', ({ sessionId } = {}) => {
      socket.to(`session:${sessionId}`).emit('chat:user_typing', {
        username: socket.data.user.name || 'Support',
      });
    });

    socket.on('agent:stop_typing', ({ sessionId } = {}) => {
      socket.to(`session:${sessionId}`).emit('chat:user_stop_typing', {
        username: socket.data.user.name || 'Support',
      });
    });

    onAsync(socket, 'agent:delete_message', async ({ sessionId, messageId } = {}) => {
      const session = await supportStore.deleteMessage(sessionId, userId, messageId);
      if (!session) return;
      namespace.to(`session:${sessionId}`).emit('agent:message_deleted', {
        sessionId,
        messageId,
      });
    });

    onAsync(socket, 'agent:close_chat', async ({ sessionId } = {}) => {
      const session = await supportStore.closeSession(sessionId, userId);
      if (!session) return;
      namespace.to(`session:${sessionId}`).emit('chat:ended', {
        sessionId,
        closedBy: 'agent',
      });
      namespace.to('staff').emit('agent:chat_closed', { sessionId });
      await Promise.all([emitQueue(), emitStats()]);
    });

    socket.on('disconnect', () => {
      supportPresence.remove(userId);
      void emitStats();
    });
  });

  logger.info('Internal Socket.IO support-chat namespace attached');
  return io;
};

module.exports = { attachSupportChat, authenticateSocket, cleanToken };
