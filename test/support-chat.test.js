'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const jwt = require('jsonwebtoken');
const { io: connect } = require('socket.io-client');

const chatPath = require.resolve('../src/realtime/supportChat');
const SECRET = 'test-secret';

// In-memory stand-in for the Mongo-backed session store, same function names.
const makeStore = () => {
  const sessions = new Map();
  const pub = (s) => ({ sessionId: s.sessionId, customer: s.customer, status: s.status, assignedAgentId: s.assignedAgentId || null, topic: s.topic });
  return {
    sessions,
    toPublicSession: pub,
    toPublicMessage: (m) => m,
    async getOrCreateCustomerSession(user, topic) {
      for (const s of sessions.values()) if (s.customerId === String(user._id) && s.open) return { session: s, created: false };
      const s = { sessionId: `s-${sessions.size + 1}`, customerId: String(user._id), customer: { _id: String(user._id), name: user.name }, status: 'waiting', open: true, topic: topic || 'general', messages: [] };
      sessions.set(s.sessionId, s);
      return { session: s, created: true };
    },
    async appendMessage(id, message) {
      const s = sessions.get(id);
      if (!s || s.status === 'closed') return null;
      s.messages.push(message);
      return s;
    },
    async listWaiting() { return [...sessions.values()].filter((s) => s.status === 'waiting'); },
    async listAssigned(agentId) { return [...sessions.values()].filter((s) => s.status === 'active' && s.assignedAgentId === agentId); },
    async listClosed() { return []; },
    async getStats() { return { todayChats: 1, totalChats: 1, queuedChats: 0, activeChats: 0 }; },
    async claimSession(id, agentId) { const s = sessions.get(id); if (!s || s.status !== 'waiting') return null; s.status = 'active'; s.assignedAgentId = agentId; return s; },
    async closeSession(id) { const s = sessions.get(id); if (!s) return null; s.status = 'closed'; s.open = false; return s; },
  };
};

const startServer = async () => {
  const originalLoad = Module._load;
  const store = makeStore();
  const users = {
    cust1: { _id: 'cust1', name: 'Wanjiru', phone: '254700000001', status: 'active', phoneVerified: true },
    agent1: { _id: 'agent1', name: 'Agent Amina', phone: '254700000002', status: 'active', phoneVerified: true, isStaff: true, adminLevel: 'support' },
  };
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === chatPath) {
      if (request === '../config') return { jwt: { secret: SECRET }, cors: { credentials: false } };
      if (request === '../utils/logger') return { info() {}, warn() {}, error() {} };
      if (request === '../domains/user/user.model') return { findById: (id) => ({ lean: async () => users[id] || null }) };
      if (request === '../domains/support/supportSession.store') return store;
      if (request === '../domains/support/supportAdmin.service') return {};
      if (request === '../middlewares/auth') {
        return { isStaffUser: (u) => Boolean(u.isStaff), getStaffLevel: (u) => u.adminLevel };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[chatPath];
  const { attachSupportChat } = require(chatPath);
  Module._load = originalLoad;

  const server = http.createServer();
  const io = attachSupportChat(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = (sub, extra = {}) => jwt.sign({ sub, ...extra }, SECRET);
  return { url, token, store, close: () => new Promise((resolve) => { io.close(); server.close(resolve); }) };
};

const wait = (socket, event, ms = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });

test('a customer sees their own message at once and the agent sees it live, and replies come back', async () => {
  const srv = await startServer();
  const customer = connect(`${srv.url}/support-chat`, { auth: { token: srv.token('cust1') }, transports: ['websocket'] });
  const agent = connect(`${srv.url}/support-chat`, { auth: { token: srv.token('agent1', { mfa: true }) }, transports: ['websocket'] });
  try {
    const history = await wait(customer, 'chat:history');
    assert.deepEqual(history.messages, []);
    await wait(agent, 'connect');
    agent.emit('agent:go_online');
    await wait(agent, 'agent:online_confirmed');

    // customer -> server -> customer (own echo, with the same clientId) and agent
    const echo = wait(customer, 'chat:new_message');
    const toAgent = wait(agent, 'agent:customer_message');
    customer.emit('chat:send_message', { content: 'Hello, my withdrawal is pending', clientId: 'c-1' });
    const mine = await echo;
    assert.equal(mine.content, 'Hello, my withdrawal is pending');
    assert.equal(mine.clientId, 'c-1');
    assert.equal(mine.senderType, 'customer');
    const seen = await toAgent;
    assert.equal(seen.message.content, 'Hello, my withdrawal is pending');

    // agent accepts, customer is told, agent replies, customer receives it
    const assigned = wait(customer, 'chat:assigned');
    agent.emit('agent:accept_chat', { sessionId: seen.sessionId });
    assert.equal((await assigned).agent.name, 'Agent Amina');
    const reply = wait(customer, 'chat:new_message');
    agent.emit('agent:send_message', { sessionId: seen.sessionId, content: 'Hi, checking now', tempId: 't1' });
    const got = await reply;
    assert.equal(got.senderType, 'agent');
    assert.equal(got.content, 'Hi, checking now');

    // closing ends the chat for the customer
    const ended = wait(customer, 'chat:ended');
    agent.emit('agent:close_chat', { sessionId: seen.sessionId });
    assert.equal((await ended).closedBy, 'agent');
  } finally {
    customer.close(); agent.close(); await srv.close();
  }
});

test('a connection with no valid token is refused', async () => {
  const srv = await startServer();
  const bad = connect(`${srv.url}/support-chat`, { auth: { token: 'nope' }, transports: ['websocket'], reconnection: false });
  try {
    const error = await wait(bad, 'connect_error');
    assert.match(error.message, /Authentication/);
  } finally {
    bad.close(); await srv.close();
  }
});

test('the community chat shows each message to everyone including the sender', async () => {
  const srv = await startServer();
  const a = connect(`${srv.url}/community-chat`, { auth: { token: srv.token('cust1') }, transports: ['websocket'] });
  try {
    await wait(a, 'chat:history');
    const echo = wait(a, 'chat:new_message');
    a.emit('chat:send_message', { content: 'Habari wote', clientId: 'x1' });
    const msg = await echo;
    assert.equal(msg.content, 'Habari wote');
    assert.equal(msg.clientId, 'x1');
  } finally {
    a.close(); await srv.close();
  }
});
