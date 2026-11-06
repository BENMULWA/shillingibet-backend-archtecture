'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const clientPath = require.resolve('../src/integrations/eurovirtuals/eurovirtuals.client');

const loadClient = (sent) => {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === clientPath) {
      if (request === '../../config') {
        return { eurovirtuals: { baseUrl: 'https://ev.example', apiKey: 'k', appKey: 'a', returnUrl: 'https://site.example' } };
      }
      if (request === '../../utils/logger') return { info() {}, warn() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  global.fetch = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ launch_url: 'https://game.example' }) };
  };
  delete require.cache[clientPath];
  try {
    return require(clientPath);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
  }
};

const launch = async (args) => {
  const sent = [];
  const client = loadClient(sent);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  try {
    await client.launchGame({ playerId: 'p1', playerName: 'Wanjiru', playerToken: 'tok', gameUuid: 'g1', currency: 'KES', ...args });
  } finally {
    global.fetch = originalFetch;
  }
  return sent[0].body;
};

test('the game is told the opening balance when it is launched', async () => {
  const body = await launch({ balance: 174.82, demo: 0 });
  assert.equal(body.balance, 174.82);
  assert.equal(body.player_token, 'tok');
});

test('a zero balance is still sent (so the game shows 0.00 on purpose, not by omission)', async () => {
  const body = await launch({ balance: 0, demo: 0 });
  assert.equal(body.balance, 0);
});

test('no balance is invented when none is given, and demo games carry none', async () => {
  assert.equal('balance' in (await launch({ demo: 0 })), false);
  assert.equal('balance' in (await launch({ balance: 50, demo: 1 })), false);
});
