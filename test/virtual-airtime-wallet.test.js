'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/virtual/virtual.service');
const USER_ID = '507f1f77bcf86cd799439011';

// A tiny in-memory stand-in for the three Mongo models the game callbacks use.
const makeWorld = ({ balance = 500, airtimeBalance = 100, activeWallet = 'balance' } = {}) => {
  const users = new Map([[USER_ID, { _id: USER_ID, balance, airtimeBalance, activeWallet }]]);
  const txns = [];
  const sessions = [];
  const clone = (value) => (value ? JSON.parse(JSON.stringify(value)) : value);
  const lean = (value) => ({ lean: async () => clone(value) });

  // Apply the wallet pipeline: [{ $set: { <field>: { $round: [{ $add: [{ $ifNull: [...] }, delta] }, 2] } } }]
  const applyInc = (user, update) => {
    const [field, expr] = Object.entries(update[0].$set)[0];
    const delta = expr.$round[0].$add[1];
    user[field] = Math.round(((user[field] ?? 0) + delta) * 100) / 100;
  };
  const meets = (user, query) =>
    Object.entries(query).every(([key, cond]) =>
      key === '_id' ? String(user._id) === String(cond) : (user[key] ?? 0) >= cond.$gte
    );

  const User = {
    findById: (id) => lean(users.get(String(id))),
    findOneAndUpdate(query, update) {
      const user = users.get(String(query._id));
      if (!user || !meets(user, query)) return lean(null);
      applyInc(user, update);
      return lean(user);
    },
    findByIdAndUpdate(id, update) {
      const user = users.get(String(id));
      applyInc(user, update);
      return lean(user);
    },
    async updateOne(query, update) {
      applyInc(users.get(String(query._id)), update);
      return { matchedCount: 1 };
    },
  };

  const matchesQuery = (txn, query) => {
    if (query.action && typeof query.action === 'string' && txn.action !== query.action) return false;
    if (query.action?.$in && !query.action.$in.includes(txn.action)) return false;
    if (query.betId && typeof query.betId === 'string' && txn.betId !== query.betId) return false;
    if (query.$or) {
      return query.$or.some((cond) => Object.entries(cond).every(([k, v]) => String(txn[k]) === String(v)));
    }
    return true;
  };
  const VirtualTxn = {
    async create(doc) {
      if (txns.some((t) => t.betId === doc.betId && t.action === doc.action)) {
        throw Object.assign(new Error('duplicate'), { code: 11000 });
      }
      txns.push(clone(doc));
      return doc;
    },
    findOne: (query) => lean(txns.find((t) => matchesQuery(t, query)) || null),
    find: (query) => lean(txns.filter((t) => matchesQuery(t, query))),
  };

  const VirtualSession = {
    async create(doc) {
      sessions.push({ ...clone(doc), createdAt: sessions.length });
      return doc;
    },
    findOne(query) {
      if (query.token) return lean(sessions.find((s) => s.token === query.token) || null);
      const mine = sessions.filter((s) => String(s.user) === String(query.user));
      return lean(mine.sort((a, b) => b.createdAt - a.createdAt)[0] || null);
    },
  };

  return { users, txns, sessions, models: { User, VirtualTxn, VirtualSession } };
};

const loadService = (world) => {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../user/user.model') return world.models.User;
      if (request === './virtualTxn.model') return world.models.VirtualTxn;
      if (request === './virtualSession.model') return world.models.VirtualSession;
      if (request === '../../config') return { eurovirtuals: { currency: 'KES', sessionTtlHours: 24 } };
      if (request === '../../utils/logger') return { info() {}, warn() {}, error() {} };
      if (request === '../../integrations/eurovirtuals/eurovirtuals.client') return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
};

const bet = (service, token, betId, amount) =>
  service.placeBet({ body: { bet_id: betId, amount, player_id: USER_ID, player_token: token, game_uuid: 'g1', game_name: 'JetX', type: 'bet' } });
const win = (service, betId, payout) =>
  service.winBet({ body: { bet_id: betId, action: 'result_bet', status: 2, player_id: USER_ID, payout_amount: payout } });

test('a game opened with the airtime wallet shows the airtime balance', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100, activeWallet: 'airtime' });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID, 'airtime');
  assert.equal(world.sessions[0].walletType, 'airtime');

  const info = await service.playerInfo({ body: { player_id: USER_ID, player_token: token } });
  assert.equal(info.data.balance, 100);
});

test('a game opened with the main wallet still shows the main balance', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100 });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID);
  assert.equal(world.sessions[0].walletType, 'balance');
  const info = await service.playerInfo({ body: { player_id: USER_ID, player_token: token } });
  assert.equal(info.data.balance, 500);
});

test('an airtime bet takes money from the airtime wallet only', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100 });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID, 'airtime');

  const res = await bet(service, token, 'bet-1', 30);
  assert.equal(res.status_code, service.CODES.SUCCESS);
  assert.equal(res.data.balance, 70);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 70);
  assert.equal(world.users.get(USER_ID).balance, 500, 'main wallet must not move');
  assert.equal(world.txns[0].walletType, 'airtime');
});

test('an airtime bet is refused when airtime is short, even if the main wallet has plenty', async () => {
  const world = makeWorld({ balance: 5000, airtimeBalance: 20 });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID, 'airtime');

  const res = await bet(service, token, 'bet-1', 50);
  assert.equal(res.status_code, service.CODES.INSUFFICIENT);
  assert.equal(world.users.get(USER_ID).balance, 5000);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 20);
});

test('a win goes back to the airtime wallet, even after the player switched wallets', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100 });
  const service = loadService(world);
  const airtimeToken = await service.issueSession(USER_ID, 'airtime');
  await bet(service, airtimeToken, 'bet-1', 40);

  // The player then switches to the main wallet and opens another game.
  world.users.get(USER_ID).activeWallet = 'balance';
  await service.issueSession(USER_ID, 'balance');

  const res = await win(service, 'bet-1', 120); // the provider's win callback carries no token
  assert.equal(res.status_code, service.CODES.SUCCESS);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 60 + 120);
  assert.equal(world.users.get(USER_ID).balance, 500, 'airtime winnings must never become cash');
  assert.equal(res.data.balance, 180);
});

test('a refund reverses the bet in the airtime wallet', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100 });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID, 'airtime');
  await bet(service, token, 'bet-1', 40);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 60);

  const res = await service.rollbackBet({ body: { bet_id: 'bet-1', player_id: USER_ID } });
  assert.equal(res.status_code, service.CODES.SUCCESS);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 100);
  assert.equal(world.users.get(USER_ID).balance, 500);
});

test('main wallet play is unchanged: bet and win use the main balance only', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100 });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID, 'balance');

  await bet(service, token, 'bet-1', 50);
  await win(service, 'bet-1', 200);
  assert.equal(world.users.get(USER_ID).balance, 650);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 100);
});

test('a repeated bet callback does not charge the airtime wallet twice', async () => {
  const world = makeWorld({ balance: 500, airtimeBalance: 100 });
  const service = loadService(world);
  const token = await service.issueSession(USER_ID, 'airtime');
  await bet(service, token, 'bet-1', 30);
  const again = await bet(service, token, 'bet-1', 30);
  assert.equal(again.status_code, service.CODES.SUCCESS);
  assert.equal(world.users.get(USER_ID).airtimeBalance, 70);
});
