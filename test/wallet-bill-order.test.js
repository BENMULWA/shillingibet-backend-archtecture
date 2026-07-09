'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../src/domains/wallet/wallet.service');

const loadService = ({ providerResponse, providerError, transaction = null } = {}) => {
  const originalLoad = Module._load;
  const state = {
    providerPayload: null,
    createdTransactions: [],
    walletUpdates: [],
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../config' && parent?.filename === servicePath) {
      return {
        apiPrefix: '/api/v1',
        fusion: {
          currency: 'KES',
          callbackBaseUrl: 'http://localhost:5050',
          callbackSecret: '',
          orderExpiryMinutes: 1,
        },
        transactpay: {
          currency: 'USD',
          defaultCountry: 'US',
          redirectUrl: 'http://localhost:5173',
        },
      };
    }

    if (request === '../../integrations/fusion/fusion.client' && parent?.filename === servicePath) {
      return {
        createBillOrder: async (payload) => {
          state.providerPayload = payload;
          if (providerError) throw providerError;
          return providerResponse || { id: 'fusion-1', checkout_url: 'https://pay.example/1' };
        },
      };
    }

    if (request === '../../integrations/transactpay/transactpay.client' && parent?.filename === servicePath) {
      return {
        createPaymentLink: async (payload) => {
          state.providerPayload = payload;
          if (providerError) throw providerError;
          return providerResponse || {
            isSuccess: true,
            message: 'Order created successfully, please proceed to url',
            redirectUrl: 'https://payment-link.transactpay.ai/payment/checkout/CARD-1',
            orderId: 3471916,
          };
        },
      };
    }

    if (request === '../transaction/transaction.model' && parent?.filename === servicePath) {
      return {
        create: async (payload) => {
          const txn = {
            ...payload,
            status: 'pending',
            saveCalls: 0,
            async save() {
              this.saveCalls += 1;
            },
            toJSON() {
              return {
                ...this,
                save: undefined,
                toJSON: undefined,
              };
            },
          };
          state.createdTransactions.push(txn);
          return txn;
        },
        findOne() {
          return {
            session() {
              return Promise.resolve(transaction);
            },
            then(resolve) {
              return Promise.resolve(transaction).then(resolve);
            },
          };
        },
        findOneAndUpdate: async () => transaction,
        findById: async () => transaction,
      };
    }

    if (request === '../user/user.model' && parent?.filename === servicePath) {
      return {
        updateOne: async (query, update) => {
          state.walletUpdates.push({ query, update });
          return { matchedCount: 1 };
        },
      };
    }

    if (request === '../../utils/db' && parent?.filename === servicePath) {
      return {
        incBalance(delta) {
          return [{ $set: { balance: { $round: [{ $add: ['$balance', delta] }, 2] } } }];
        },
        incWalletBalance(walletType, delta) {
          const field = walletType === 'airtime' ? 'airtimeBalance' : 'balance';
          return [{ $set: { [field]: { $round: [{ $add: [`$${field}`, delta] }, 2] } } }];
        },
        normalizeWalletType(walletType) {
          return walletType === 'airtime' ? 'airtime' : 'balance';
        },
        withTransaction: async (txnFn) => txnFn('session-1'),
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

test('createBillOrder uses the request email when provided and persists provider response', async () => {
  const { service, state } = loadService({
    providerResponse: {
      order: {
        ID: 41,
        external_ref: 'AMZ-ORDER-123',
        comment_ref: 'amazon-cart-123',
        payer_email: 'payer@example.com',
        amount: 1,
        currency: 'KES',
        status: 'pending',
        description: 'Amazon order #123',
        callback_url: '',
      },
      status: 'success',
    },
  });

  const result = await service.createBillOrder(
    { _id: 'user-1', phone: '254700000002', email: 'account@example.com' },
    {
      amount: 1,
      currency: 'KES',
      comment: 'amazon-cart-123',
      email: 'payer@example.com',
      description: 'Amazon order #123',
      external_ref: 'AMZ-ORDER-123',
    }
  );

  assert.equal(state.providerPayload.email, 'payer@example.com');
  assert.equal(state.providerPayload.external_ref, 'AMZ-ORDER-123');
  assert.equal(state.createdTransactions[0].provider, 'Fusion');
  assert.equal(state.createdTransactions[0].walletType, 'balance');
  assert.equal(result.transaction.secureId, '41');
  assert.equal(result.transaction.receipt, 'amazon-cart-123');
  assert.deepEqual(result.provider, {
    order: {
      ID: 41,
      external_ref: 'AMZ-ORDER-123',
      comment_ref: 'amazon-cart-123',
      payer_email: 'payer@example.com',
      amount: 1,
      currency: 'KES',
      status: 'pending',
      description: 'Amazon order #123',
      callback_url: '',
    },
    status: 'success',
  });
  assert.equal(result.transaction.externalId, 'AMZ-ORDER-123');
});

test('createBillOrder falls back to the authenticated user email', async () => {
  const { service, state } = loadService();

  await service.createBillOrder(
    { _id: 'user-1', phone: '254700000002', email: 'account@example.com' },
    { amount: 5, currency: 'KES' }
  );

  assert.equal(state.providerPayload.email, 'account@example.com');
  assert.match(state.providerPayload.external_ref, /^FUS-/);
  assert.match(state.providerPayload.callback_url, /\/api\/v1\/wallet\/billOrder\/callback/);
});

test('createBillOrder rejects requests with no available email', async () => {
  const { service } = loadService();

  await assert.rejects(
    service.createBillOrder(
      { _id: 'user-1', phone: '254700000002', email: '' },
      { amount: 5, currency: 'KES' }
    ),
    /Email is required/
  );
});

test('createBillOrder marks the transaction failed when Fusion rejects the request', async () => {
  const { service, state } = loadService({
    providerError: new Error('Fusion is unavailable'),
  });

  await assert.rejects(
    service.createBillOrder(
      { _id: 'user-1', phone: '254700000002', email: 'account@example.com' },
      { amount: 5, currency: 'KES', external_ref: 'FAIL-1' }
    ),
    /Fusion is unavailable/
  );

  assert.equal(state.createdTransactions[0].status, 'failed');
  assert.equal(state.createdTransactions[0].failureReason, 'Fusion is unavailable');
});

test('createCardPaymentLink creates a TransactPay redirect and stores the provider response', async () => {
  const { service, state } = loadService({
    providerResponse: {
      isSuccess: true,
      message: 'Order created successfully, please proceed to url',
      redirectUrl: 'https://payment-link.transactpay.ai/payment/checkout/USD-LINK-1',
      orderId: 3471916,
    },
  });

  const result = await service.createCardPaymentLink(
    { _id: 'user-1', phone: '254700000002', email: 'account@example.com', name: 'Mary Jane' },
    { amount: 100, currency: 'USD', country: 'US' }
  );

  assert.equal(state.providerPayload.customer.firstname, 'Mary');
  assert.equal(state.providerPayload.customer.lastname, 'Jane');
  assert.equal(state.providerPayload.customer.email, 'account@example.com');
  assert.equal(state.providerPayload.order.currency, 'USD');
  assert.equal(state.providerPayload.payment.RedirectUrl, 'http://localhost:5173');
  assert.equal(state.createdTransactions[0].provider, 'TransactPay');
  assert.equal(state.createdTransactions[0].walletType, 'balance');
  assert.equal(result.transaction.secureId, '3471916');
  assert.equal(result.redirectUrl, 'https://payment-link.transactpay.ai/payment/checkout/USD-LINK-1');
});

test('createCardPaymentLink stores the active airtime wallet on the pending transaction', async () => {
  const { service, state } = loadService();

  await service.createCardPaymentLink(
    { _id: 'user-1', phone: '254700000002', email: 'account@example.com', name: 'Mary Jane', activeWallet: 'airtime' },
    { amount: 100, currency: 'USD', country: 'US' }
  );

  assert.equal(state.createdTransactions[0].walletType, 'airtime');
});

test('createCardPaymentLink uses request overrides and rejects when no email is available', async () => {
  const { service, state } = loadService();

  await service.createCardPaymentLink(
    { _id: 'user-1', phone: '254700000002', email: '', name: '' },
    {
      amount: 25,
      currency: 'usd',
      country: 'ng',
      email: 'payer@example.com',
      phone: '0700000000',
      first_name: 'Card',
      last_name: 'Player',
      redirect_url: 'https://example.com/return',
      external_ref: 'CARD-REF-1',
    }
  );

  assert.equal(state.providerPayload.customer.firstname, 'Card');
  assert.equal(state.providerPayload.customer.lastname, 'Player');
  assert.equal(state.providerPayload.customer.mobile, '0700000000');
  assert.equal(state.providerPayload.customer.country, 'NG');
  assert.equal(state.providerPayload.order.reference, 'CARD-REF-1');
  assert.equal(state.providerPayload.order.currency, 'USD');
  assert.equal(state.providerPayload.payment.RedirectUrl, 'https://example.com/return');

  await assert.rejects(
    service.createCardPaymentLink(
      { _id: 'user-2', phone: '254700000003', email: '', name: '' },
      { amount: 25, currency: 'USD', country: 'US' }
    ),
    /Email is required/
  );
});

test('createCardPaymentLink marks the transaction failed when TransactPay rejects the request', async () => {
  const { service, state } = loadService({
    providerError: new Error('TransactPay is unavailable'),
  });

  await assert.rejects(
    service.createCardPaymentLink(
      { _id: 'user-1', phone: '254700000002', email: 'account@example.com', name: 'Mary Jane' },
      { amount: 50, currency: 'USD', country: 'US' }
    ),
    /TransactPay is unavailable/
  );

  assert.equal(state.createdTransactions[0].status, 'failed');
  assert.equal(state.createdTransactions[0].failureReason, 'TransactPay is unavailable');
});

test('handleCallback credits the wallet once when Fusion marks the order approved', async () => {
  const txn = {
    _id: 'txn-1',
    user: 'user-1',
    type: 'deposit',
    provider: 'Fusion',
    amount: 1,
    currency: 'KES',
    walletType: 'airtime',
    externalId: 'AMZ-ORDER-123',
    status: 'pending',
    walletAppliedAt: null,
    async save() {},
  };
  const { service, state } = loadService({ transaction: txn });

  const result = await service.handleCallback({
    amount: 1,
    comment_ref: 'amazon-cart-123',
    currency: 'KES',
    external_ref: 'AMZ-ORDER-123',
    order_id: 47,
    payer_email: 'collscodes@gmail.com',
    status: 'approved',
    updated_at: '2026-07-02T11:13:56.497Z',
    user_id: 53,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  assert.equal(state.walletUpdates.length, 1);
  assert.deepEqual(state.walletUpdates[0].update, [
    { $set: { airtimeBalance: { $round: [{ $add: ['$airtimeBalance', 1] }, 2] } } },
  ]);
  assert.equal(txn.status, 'completed');
  assert.equal(txn.secureId, '47');
  assert.equal(txn.receipt, 'amazon-cart-123');
  assert.ok(txn.walletAppliedAt instanceof Date);
});

test('handleCallback does not credit the wallet when Fusion declines the order', async () => {
  const txn = {
    _id: 'txn-1',
    user: 'user-1',
    type: 'deposit',
    provider: 'Fusion',
    amount: 1,
    currency: 'KES',
    externalId: 'AMZ-ORDER-123',
    status: 'pending',
    walletAppliedAt: null,
    async save() {},
  };
  const { service, state } = loadService({ transaction: txn });

  const result = await service.handleCallback({
    amount: 1,
    comment_ref: 'amazon-cart-123',
    currency: 'KES',
    external_ref: 'AMZ-ORDER-123',
    order_id: 46,
    payer_email: 'collscodes@gmail.com',
    status: 'declined',
    updated_at: '2026-07-02T11:13:24.672Z',
    user_id: 53,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'failed');
  assert.equal(state.walletUpdates.length, 0);
  assert.equal(txn.status, 'failed');
});

test('handleCallback marks a stale Fusion order expired and does not credit the wallet', async () => {
  const txn = {
    _id: 'txn-1',
    user: 'user-1',
    type: 'deposit',
    provider: 'Fusion',
    amount: 1,
    currency: 'KES',
    externalId: 'AMZ-ORDER-123',
    status: 'pending',
    walletAppliedAt: null,
    createdAt: new Date(Date.now() - 61 * 1000),
    rawCallback: null,
    async save() {},
  };
  const { service, state } = loadService({ transaction: txn });

  const result = await service.handleCallback({
    amount: 1,
    comment_ref: 'amazon-cart-123',
    currency: 'KES',
    external_ref: 'AMZ-ORDER-123',
    order_id: 47,
    payer_email: 'collscodes@gmail.com',
    status: 'approved',
    updated_at: '2026-07-02T11:13:56.497Z',
    user_id: 53,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'expired');
  assert.equal(state.walletUpdates.length, 0);
  assert.equal(txn.status, 'expired');
});
