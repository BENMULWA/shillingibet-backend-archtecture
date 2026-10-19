'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const clientPath = require.resolve('../src/integrations/mamlaka/mamlaka.client');

const loadClient = ({ fetchImpl }) => {
  const originalLoad = Module._load;
  const originalFetch = global.fetch;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../config' && parent?.filename === clientPath) {
      return {
        mamlaka: {
          baseUrl: 'https://payments.mam-laka.com',
          username: 'merchant-user',
          password: 'secret',
          merchantId: 'shilingibet',
        },
      };
    }

    if (request === '../../utils/logger' && parent?.filename === clientPath) {
      return { error() {} };
    }

    if (request === '../../utils/ApiError' && parent?.filename === clientPath) {
      return class ApiError extends Error {
        constructor(statusCode, message, details) {
          super(message);
          this.statusCode = statusCode;
          this.details = details;
        }
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = fetchImpl;

  delete require.cache[clientPath];
  const client = require(clientPath);

  return {
    client,
    cleanup() {
      Module._load = originalLoad;
      global.fetch = originalFetch;
    },
  };
};

test('getTransactionStatus uses the documented query endpoint and normalizes snake_case response fields', async () => {
  const fetchCalls = [];
  const { client, cleanup } = loadClient({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      if (String(url).endsWith('/api/v1/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'aaa.bbb.ccc' }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          transaction: {
            amount: 10,
            currency: 'KES',
            external_id: 'DEP-123',
            secure_id: 'secure-123',
            transaction_report: 'collection',
            transaction_status: 'PENDING',
            reference: 'UG9LBADXUO',
          },
        }),
      };
    },
  });
  try {
    const result = await client.getTransactionStatus('secure-123');

    assert.match(
      String(fetchCalls[1]),
      /\/api\/v1\/transaction\?merchant=shilingibet&secureId=secure-123$/
    );
    assert.equal(result.externalId, 'DEP-123');
    assert.equal(result.secureId, 'secure-123');
    assert.equal(result.transactionStatus, 'PENDING');
    assert.equal(result.transactionReceipt, 'UG9LBADXUO');
  } finally {
    cleanup();
  }
});
