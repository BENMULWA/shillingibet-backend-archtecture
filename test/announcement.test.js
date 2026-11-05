'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/announcement/announcement.service');
const schemas = require('../src/domains/announcement/announcement.validation');

const ADMIN = { _id: '507f1f77bcf86cd799439011', name: 'Amina' };

const loadService = () => {
  const originalLoad = Module._load;
  const state = { docs: [], broadcasts: [], filters: [] };
  const Announcement = {
    async create(doc) {
      const saved = { _id: `id${state.docs.length + 1}`, createdAt: new Date('2026-11-05T12:00:00Z'), deletedAt: null, ...doc };
      state.docs.push(saved);
      return saved;
    },
    find(filter) {
      state.filters.push(filter);
      const rows = state.docs.filter((d) => d.deletedAt === null);
      return { sort() { return this; }, limit() { return this; }, lean: async () => rows };
    },
    findOneAndUpdate(filter, update) {
      const doc = state.docs.find((d) => String(d._id) === String(filter._id) && d.deletedAt === null);
      if (doc) Object.assign(doc, update.$set);
      return { lean: async () => doc || null };
    },
  };
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === './announcement.model') return Announcement;
      if (request === '../../realtime/supportChat') return { broadcastAnnouncement: (event, payload) => state.broadcasts.push({ event, payload }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  try {
    return { service: require(servicePath), state };
  } finally {
    Module._load = originalLoad;
  }
};

test('an announcement is saved and pushed to connected players, without internal fields', async () => {
  const { service, state } = loadService();
  const created = await service.create(ADMIN, { title: 'We are back', message: 'Please log in and play.' });

  assert.equal(state.docs.length, 1);
  assert.equal(state.docs[0].createdBy, ADMIN._id);
  assert.deepEqual(Object.keys(created).sort(), ['author', 'createdAt', 'id', 'message', 'title']);
  assert.equal(created.author, 'Amina');
  assert.equal(state.broadcasts[0].event, 'announcement:new');
  assert.equal(state.broadcasts[0].payload.message, 'Please log in and play.');
});

test('removed announcements disappear from the list and players are told', async () => {
  const { service, state } = loadService();
  const a = await service.create(ADMIN, { message: 'First one' });
  await service.create(ADMIN, { message: 'Second one' });

  await service.remove(a.id);
  const shown = await service.list();
  assert.deepEqual(shown.map((x) => x.message), ['Second one']);
  assert.equal(state.broadcasts.at(-1).event, 'announcement:removed');
  assert.equal(state.broadcasts.at(-1).payload.id, a.id);
  assert.deepEqual(state.filters[0], { deletedAt: null });

  await assert.rejects(service.remove(a.id), /not found/i);
});

test('announcement text is validated', () => {
  assert.equal(schemas.create.safeParse({ message: 'ok' }).success, false, 'too short');
  assert.equal(schemas.create.safeParse({ message: 'x'.repeat(1001) }).success, false, 'too long');
  assert.equal(schemas.create.safeParse({ title: 't'.repeat(81), message: 'Hello players' }).success, false, 'title too long');
  const ok = schemas.create.safeParse({ message: '  Hello players  ' });
  assert.equal(ok.success, true);
  assert.equal(ok.data.message, 'Hello players');
  assert.equal(ok.data.title, '');
});
