'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const storePath = require.resolve('../src/domains/support/supportSession.store');
const adminServicePath = require.resolve('../src/domains/support/supportAdmin.service');

const ALICE = '507f1f77bcf86cd799439011';
const BOB = '507f1f77bcf86cd799439022';

const withMocks = (modulePath, mocks, fn) => {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === modulePath && mocks[request]) return mocks[request]();
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[modulePath];
  try {
    return fn(require(modulePath));
  } finally {
    Module._load = originalLoad;
  }
};

const aliceChat = {
  sessionId: 'a1111111-1111-4111-8111-111111111111',
  customerId: ALICE,
  status: 'closed',
  topic: 'general',
  messages: [
    { messageId: 'm1', senderType: 'customer', content: 'My withdrawal is stuck', createdAt: '2026-11-01T10:00:00Z' },
    { messageId: 'm2', senderType: 'agent', content: 'Checking now '.repeat(30), createdAt: '2026-11-01T10:01:00Z' },
  ],
};

const lean = (value) => ({ lean: async () => value });

test('the history list is scoped to the requesting player', async () => {
  let pipeline;
  const SupportSession = {
    aggregate: async (p) => {
      pipeline = p;
      return [{ sessionId: aliceChat.sessionId, status: 'closed', messageCount: 2, lastMessage: aliceChat.messages[1] }];
    },
  };
  await withMocks(storePath, { './supportSession.model': () => SupportSession, '../notification/notification.service': () => ({}) }, async (store) => {
    const rows = await store.listForCustomer(ALICE);
    assert.equal(String(pipeline[0].$match.customerId), ALICE, 'must match only this player\'s chats');
    assert.equal(rows.length, 1);
    assert.ok(rows[0].lastMessage.content.length <= 140, 'the preview is shortened');
    assert.equal(rows[0].lastMessage.senderType, 'agent');
  });
});

test('a player can open their own chat but never someone else\'s', async () => {
  const SupportSession = {
    findOne: (filter) => lean(filter.sessionId === aliceChat.sessionId && String(filter.customerId) === String(aliceChat.customerId) ? aliceChat : null),
  };
  await withMocks(storePath, { './supportSession.model': () => SupportSession, '../notification/notification.service': () => ({}) }, async (store) => {
    const own = await store.getForCustomer(ALICE, aliceChat.sessionId);
    assert.equal(own.messages.length, 2);
    assert.equal(await store.getForCustomer(BOB, aliceChat.sessionId), null, 'Bob must not read Alice\'s chat');
  });
});

test('admins see every closed chat, support agents only their own', async () => {
  const filters = [];
  const chain = { sort() { return this; }, limit() { return this; }, lean: async () => [] };
  const SupportSession = { find: (filter) => { filters.push(filter); return chain; }, findOne: (filter) => { filters.push(filter); return lean(null); } };
  await withMocks(storePath, { './supportSession.model': () => SupportSession, '../notification/notification.service': () => ({}) }, async (store) => {
    await store.listClosed('agent-1', 100, { all: true });
    await store.listClosed('agent-1', 100);
    await store.findClosedSession('s1', 'agent-1', { all: true });
    await store.findClosedSession('s1', 'agent-1');
  });
  assert.deepEqual(filters[0], { status: 'closed' });
  assert.deepEqual(filters[1], { status: 'closed', assignedAgentId: 'agent-1' });
  assert.deepEqual(filters[2], { sessionId: 's1', status: 'closed' });
  assert.deepEqual(filters[3], { sessionId: 's1', status: 'closed', assignedAgentId: 'agent-1' });
});

test('admin chat search by phone finds the same player for 07... and 254... numbers', async () => {
  const filters = [];
  const chain = { populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [] };
  const SupportSession = { find: (filter) => { filters.push(filter); return chain; } };
  await withMocks(
    adminServicePath,
    {
      '../user/user.model': () => ({}),
      './supportSession.model': () => SupportSession,
      './supportSession.store': () => ({ toPublicSession: (s) => s }),
      './supportPresence': () => ({}),
      '../../utils/ApiError': () => ({}),
    },
    async (service) => {
      await service.listSessions({ limit: 50, phone: '0714073826' });
      await service.listSessions({ limit: 50, phone: '3826' });
      await service.listSessions({ limit: 50, status: 'closed' });
    }
  );
  assert.equal(filters[0]['customer.phone'].$regex, '254714073826');
  assert.equal(filters[1]['customer.phone'].$regex, '3826');
  assert.deepEqual(filters[2], { status: 'closed' });
});
