'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/virtual/virtual.service');

const loadService = ({ user, sessionUserId = null }) => {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../user/user.model' && parent?.filename === servicePath) {
      return {
        findById() {
          return { lean: async () => user };
        },
      };
    }
    if (request === './virtualTxn.model' && parent?.filename === servicePath) {
      return {};
    }
    if (request === './virtualSession.model' && parent?.filename === servicePath) {
      return {
        findOne() {
          return { lean: async () => (sessionUserId ? { user: sessionUserId } : null) };
        },
      };
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

test('win callback rejects a missing payout before looking up the player', async () => {
  const service = loadService({ user: null });
  const response = await service.winBet({
    body: { bet_id: 'bet-1', player_id: '507f1f77bcf86cd799439011' },
  });

  assert.equal(response.status_code, service.CODES.MISSING_PARAMS);
  assert.match(response.status_description, /Missing required parameters/);
});

for (const payout_amount of [0, -10, 'not-a-number', Infinity]) {
  test(`win callback rejects invalid payout: ${String(payout_amount)}`, async () => {
    const service = loadService({ user: null });
    const response = await service.winBet({
      body: {
        bet_id: 'bet-1',
        action: 'result_bet',
        status: 2,
        player_id: '507f1f77bcf86cd799439011',
        payout_amount,
      },
    });

    assert.equal(response.status_code, service.CODES.MISSING_PARAMS);
    assert.match(response.status_description, /positive number/);
  });
}

test('win callback treats an empty payout as missing', async () => {
  const service = loadService({ user: null });
  const response = await service.winBet({
    body: {
      bet_id: 'bet-1',
      player_id: '507f1f77bcf86cd799439011',
      payout_amount: '',
    },
  });

  assert.equal(response.status_code, service.CODES.MISSING_PARAMS);
  assert.match(response.status_description, /Missing required parameters/);
});

test('win callback rejects a non-winning status before crediting', async () => {
  const service = loadService({ user: null });
  const response = await service.winBet({
    body: {
      bet_id: 'bet-1',
      action: 'result_bet',
      status: 9,
      player_id: '507f1f77bcf86cd799439011',
      payout_amount: 17.8,
    },
  });

  assert.equal(response.status_code, service.CODES.MISSING_PARAMS);
  assert.match(response.status_description, /unsupported win status/i);
});

for (const status of [1, 3, 4, 5, 7]) {
  test(`win callback accepts status ${status} as a no-credit outcome`, async () => {
    const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
    const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 100 });

    const response = await service.winBet({
      body: {
        bet_id: `bet-status-${status}`,
        action: 'result_bet',
        status,
        player_id: user._id,
        payout_amount: 0,
        currency: 'KES',
      },
    });

    assert.equal(response.status_code, service.CODES.SUCCESS);
    assert.equal(response.data.balance, 100);
    assert.equal(state.createdTxns.length, 1);
    assert.equal(state.createdTxns[0].action, 'result_bet');
    assert.equal(state.createdTxns[0].payout, 0);
    assert.equal(state.createdTxns[0].delta, 0);
  });
}

test('win callback accepts status 2 as a credited win', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 117.8 });

  const response = await service.winBet({
    body: {
      bet_id: 'bet-status-2',
      action: 'result_bet',
      status: 2,
      player_id: user._id,
      payout_amount: 17.8,
      currency: 'KES',
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 117.8);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].action, 'result_bet');
  assert.equal(state.createdTxns[0].payout, 17.8);
  assert.equal(state.createdTxns[0].delta, 17.8);
});

test('win callback rejects unsupported result actions before crediting', async () => {
  const service = loadService({ user: null });
  const response = await service.winBet({
    body: {
      bet_id: 'bet-1',
      action: 'rollback_bet',
      status: 2,
      player_id: '507f1f77bcf86cd799439011',
      payout_amount: 17.8,
    },
  });

  assert.equal(response.status_code, service.CODES.MISSING_PARAMS);
  assert.match(response.status_description, /Invalid win action/);
});

test('player_info callback returns balance with EV success metadata', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 200 };
  const service = loadService({ user, sessionUserId: user._id });

  const response = await service.playerInfo({
    body: {
      player_id: user._id,
      player_token: 'token-1',
      currency: 'USD',
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 200);
  assert.equal(response.data.currency, 'KES');
  assert.match(response.data.reference_id, /^[0-9a-f-]{36}$/);
  assert.match(response.data.date, /^\d{4}-\d{2}-\d{2} /);
});

test('player_info callback rejects a missing player_token', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 200 };
  const service = loadService({ user });

  const response = await service.playerInfo({
    body: {
      player_id: user._id,
      currency: 'KES',
    },
  });

  assert.equal(response.status_code, service.CODES.UNAUTHORISED);
  assert.match(response.status_description, /Unauthorised access/);
});

test('player_info callback rejects a mismatched player_token', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 200 };
  const service = loadService({ user, sessionUserId: '507f1f77bcf86cd799439012' });

  const response = await service.playerInfo({
    body: {
      player_id: user._id,
      player_token: 'token-1',
      currency: 'KES',
    },
  });

  assert.equal(response.status_code, service.CODES.UNAUTHORISED);
  assert.match(response.status_description, /Unauthorised access/);
});

const loadServiceWithWinDeps = ({ user, balanceAfter = 117.8, placeTxn = null }) => {
  const originalLoad = Module._load;
  const state = {
    createdTxns: [],
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../user/user.model' && parent?.filename === servicePath) {
      return {
        findById() {
          return { lean: async () => user };
        },
        findByIdAndUpdate() {
          return { lean: async () => ({ ...user, balance: balanceAfter }) };
        },
      };
    }
    if (request === './virtualTxn.model' && parent?.filename === servicePath) {
      return {
        findOne(query) {
          const matchesPlaceTxn =
            query?.action === 'place_bet' &&
            (
              query?.betId === placeTxn?.betId ||
              query?.providerTransactionId === placeTxn?.providerTransactionId ||
              query?.operatorReferenceId === placeTxn?.operatorReferenceId ||
              query?.$or?.some(
                (candidate) =>
                  candidate?.betId === placeTxn?.betId ||
                  candidate?.providerTransactionId === placeTxn?.providerTransactionId ||
                  candidate?.operatorReferenceId === placeTxn?.operatorReferenceId
              )
            );
          if (matchesPlaceTxn) {
            return { lean: async () => placeTxn };
          }
          return { lean: async () => null };
        },
        create: async (payload) => {
          state.createdTxns.push(payload);
          return payload;
        },
      };
    }
    if (request === './virtualSession.model' && parent?.filename === servicePath) {
      return {};
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

const loadServiceWithPlaceDeps = ({ user, balanceAfter = 75 }) => {
  const originalLoad = Module._load;
  const state = {
    createdTxns: [],
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../user/user.model' && parent?.filename === servicePath) {
      return {
        findById() {
          return { lean: async () => user };
        },
        findOneAndUpdate() {
          return { lean: async () => ({ ...user, balance: balanceAfter }) };
        },
        updateOne: async () => ({}),
      };
    }
    if (request === './virtualTxn.model' && parent?.filename === servicePath) {
      return {
        findOne() {
          return { lean: async () => null };
        },
        create: async (payload) => {
          state.createdTxns.push(payload);
          return payload;
        },
      };
    }
    if (request === './virtualSession.model' && parent?.filename === servicePath) {
      return {
        findOne() {
          return { lean: async () => ({ user: user._id }) };
        },
      };
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

const loadServiceWithRollbackDeps = ({ user, priorTxns, balanceAfter = 100 }) => {
  const originalLoad = Module._load;
  const state = {
    createdTxns: [],
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../user/user.model' && parent?.filename === servicePath) {
      return {
        findById() {
          return { lean: async () => user };
        },
        findByIdAndUpdate() {
          return { lean: async () => ({ ...user, balance: balanceAfter }) };
        },
        updateOne: async () => ({}),
      };
    }
    if (request === './virtualTxn.model' && parent?.filename === servicePath) {
      return {
        findOne(query) {
          if (query?.action === 'rollback_bet') return { lean: async () => null };
          if (query?.action === 'place_bet') {
            const placeTxn = priorTxns.find((txn) => txn.action === 'place_bet') || null;
            const matchesPlaceTxn =
              placeTxn &&
              (
                query?.betId === placeTxn.betId ||
                query?.providerTransactionId === placeTxn.providerTransactionId ||
                query?.operatorReferenceId === placeTxn.operatorReferenceId ||
                query?.$or?.some(
                  (candidate) =>
                    candidate?.betId === placeTxn.betId ||
                    candidate?.providerTransactionId === placeTxn.providerTransactionId ||
                    candidate?.operatorReferenceId === placeTxn.operatorReferenceId
                )
              );
            if (matchesPlaceTxn) {
              return { lean: async () => placeTxn };
            }
            return { lean: async () => priorTxns.find((txn) => txn.action === 'place_bet') || null };
          }
          return { lean: async () => null };
        },
        find(query) {
          return {
            lean: async () =>
              priorTxns.filter(
                (txn) =>
                  txn.betId === query?.betId &&
                  query?.action?.$in?.includes(txn.action)
              ),
          };
        },
        create: async (payload) => {
          state.createdTxns.push(payload);
          return payload;
        },
      };
    }
    if (request === './virtualSession.model' && parent?.filename === servicePath) {
      return {
        findOne() {
          return { lean: async () => ({ user: user._id }) };
        },
      };
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

test('bet callback accepts transaction_id as the provider bet reference', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const { service, state } = loadServiceWithPlaceDeps({ user, balanceAfter: 75 });

  const response = await service.placeBet({
    body: {
      transaction_id: 'STRATAKAGAJ',
      status: 1,
      amount: 25,
      currency: 'KES',
      action: 'place_bet',
      player_id: user._id,
      player_token: 'token-1',
      game_uuid: 'game-1',
      game_name: 'Virtual League',
      total_games: 2,
      bonus: 0,
      data: [{ event_id: '987627', status: 1 }],
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 75);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].betId, 'STRATAKAGAJ');
  assert.equal(state.createdTxns[0].providerTransactionId, 'STRATAKAGAJ');
  assert.equal(state.createdTxns[0].action, 'place_bet');
  assert.equal(state.createdTxns[0].amount, 25);
});

test('rollback callback reverses the net applied amount for the documented bet_id', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 0 };
  const { service, state } = loadServiceWithRollbackDeps({
    user,
    balanceAfter: 100,
    priorTxns: [
      {
        user: user._id,
        betId: 'STRATAKAGAJ',
        action: 'place_bet',
        delta: -100,
        currency: 'KES',
      },
    ],
  });

  const response = await service.rollbackBet({
    body: {
      bet_id: 'STRATAKAGAJ',
      transaction_id: '0001-01KWAZF1RH-15CT1Z7QZ2WF',
      operator_reference_id: 'reference',
      status: 7,
      bet_amount: 100,
      payout_amount: 244.1,
      currency: 'KES',
      action: 'rollback_bet',
      player_id: user._id,
      player_token: 'token-1',
      game_uuid: 'game-1',
      game_name: 'Virtual League',
      total_games: 2,
      data: [{ event_id: '987627', status: 4 }],
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 100);
  assert.equal(response.data.currency, 'KES');
  assert.match(response.data.date, /^\d{4}-\d{2}-\d{2} /);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].betId, 'STRATAKAGAJ');
  assert.equal(state.createdTxns[0].action, 'rollback_bet');
  assert.equal(state.createdTxns[0].delta, 100);
  assert.equal(state.createdTxns[0].providerTransactionId, '0001-01KWAZF1RH-15CT1Z7QZ2WF');
  assert.equal(state.createdTxns[0].operatorReferenceId, 'reference');
});

test('win callback accepts amount as a payout alias and credits the wallet', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 117.8 });

  const response = await service.winBet({
    body: {
      bet_id: 'bet-1',
      action: 'result_bet',
      status: 2,
      player_id: user._id,
      amount: '17.8',
      currency: 'KES',
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 117.8);
  assert.equal(state.createdTxns.length, 1);
});

test('win callback accepts payout as a payout alias and records the credited amount', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 117.8 });

  const response = await service.winBet({
    body: {
      bet_id: 'bet-2',
      action: 'result_freebet',
      status: 2,
      player_id: user._id,
      payout: 17.8,
      currency: 'KES',
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].action, 'result_freebet');
  assert.equal(state.createdTxns[0].payout, 17.8);
});

test('win callback accepts nested data.payout_amount and credits the wallet', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 117.8 });

  const response = await service.winBet({
    body: {
      bet_id: 'bet-3',
      action: 'result_bet',
      status: 2,
      player_id: user._id,
      currency: 'KES',
      payout_amount: '',
      data: {
        payout_amount: '17.8',
      },
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 117.8);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].payout, 17.8);
});

test('win callback falls back to the original place_bet user when player_id is omitted', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const placeTxn = {
    betId: 'bet-3b',
    action: 'place_bet',
    user: user._id,
    gameUuid: 'game-3b',
    gameName: 'Virtual Horses',
    currency: 'KES',
  };
  const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 121.5, placeTxn });

  const response = await service.winBet({
    body: {
      bet_id: 'bet-3b',
      action: 'result_bet',
      status: 2,
      currency: 'KES',
      won_amount: '21.5',
      data: {
        operatorReferenceId: 'op-ref-3b',
      },
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 121.5);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].gameUuid, 'game-3b');
  assert.equal(state.createdTxns[0].gameName, 'Virtual Horses');
  assert.equal(state.createdTxns[0].operatorReferenceId, 'op-ref-3b');
});

test('win callback falls back to the original place_bet user when player_id is invalid but transaction_id matches', async () => {
  const user = { _id: '507f1f77bcf86cd799439011', balance: 100 };
  const placeTxn = {
    betId: 'STRATAKAGAJ',
    providerTransactionId: '0001-01KWAZD781-R7FXHMDBWDT2',
    operatorReferenceId: 'reference',
    action: 'place_bet',
    user: user._id,
    gameUuid: 'gfhjdghvfdvsaddd',
    gameName: 'Virtual League',
    currency: 'KES',
  };
  const { service, state } = loadServiceWithWinDeps({ user, balanceAfter: 344.1, placeTxn });

  const response = await service.winBet({
    body: {
      bet_id: 'STRATAKAGAJ',
      transaction_id: '0001-01KWAZD781-R7FXHMDBWDT2',
      operator_reference_id: 'reference',
      status: 2,
      payout_amount: 244.1,
      currency: 'KES',
      action: 'result_bet',
      player_id: '1234',
      player_token: 'ghgdfvjecdwksdb2e',
      game_uuid: 'gfhjdghvfdvsaddd',
      game_name: 'Virtual League',
    },
  });

  assert.equal(response.status_code, service.CODES.SUCCESS);
  assert.equal(response.data.balance, 344.1);
  assert.equal(state.createdTxns.length, 1);
  assert.equal(state.createdTxns[0].betId, 'STRATAKAGAJ');
  assert.equal(state.createdTxns[0].providerTransactionId, '0001-01KWAZD781-R7FXHMDBWDT2');
  assert.equal(state.createdTxns[0].operatorReferenceId, 'reference');
});

test('extractProviderBetStatus finds a nested provider bet row and payout amount', async () => {
  const service = loadService({ user: null });
  const status = service.extractProviderBetStatus(
    {
      status_code: 200,
      data: {
        rows: [
          {
            bet_id: 'bet-4',
            payout_amount: '17.8',
            game_uuid: 'game-1',
            game_name: 'Euro League',
            operator_reference_id: 'op-ref-1',
            status: 'won',
          },
        ],
      },
    },
    'bet-4'
  );

  assert.deepEqual(
    {
      betId: status.betId,
      payoutAmount: status.payoutAmount,
      gameUuid: status.gameUuid,
      gameName: status.gameName,
      operatorReferenceId: status.operatorReferenceId,
      status: status.status,
    },
    {
      betId: 'bet-4',
      payoutAmount: '17.8',
      gameUuid: 'game-1',
      gameName: 'Euro League',
      operatorReferenceId: 'op-ref-1',
      status: 'won',
    }
  );
});

test('extractProviderBetStatus prefers the most complete matching provider row across payload variants', async () => {
  const service = loadService({ user: null });
  const status = service.extractProviderBetStatus(
    {
      status_code: 200,
      data: {
        summary: {
          bet_id: 'bet-5',
        },
        bets: [
          {
            betId: 'bet-5',
            data: {
              wonAmount: '44.25',
              gameUuid: 'game-5',
              gameName: 'Virtual Dogs',
              operatorReferenceId: 'op-ref-5',
              result: 'won',
            },
          },
        ],
      },
    },
    'bet-5'
  );

  assert.deepEqual(
    {
      betId: status.betId,
      payoutAmount: status.payoutAmount,
      gameUuid: status.gameUuid,
      gameName: status.gameName,
      operatorReferenceId: status.operatorReferenceId,
      status: status.status,
    },
    {
      betId: 'bet-5',
      payoutAmount: '44.25',
      gameUuid: 'game-5',
      gameName: 'Virtual Dogs',
      operatorReferenceId: 'op-ref-5',
      status: 'won',
    }
  );
});
