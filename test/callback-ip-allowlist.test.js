'use strict';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { callbackIpAllowlist, ipMatches, isAllowed } = require('../src/middlewares/callbackIpAllowlist');
const gatewayWatch = require('../src/domains/admin/gatewayWatch.service');

test('exact addresses and CIDR ranges match', () => {
  assert.equal(ipMatches('41.90.1.5', '41.90.1.5'), true);
  assert.equal(ipMatches('::ffff:41.90.1.5', '41.90.1.5'), true);
  assert.equal(ipMatches('41.90.1.6', '41.90.1.5'), false);
  assert.equal(ipMatches('41.90.1.200', '41.90.1.0/24'), true);
  assert.equal(ipMatches('41.90.2.1', '41.90.1.0/24'), false);
  assert.equal(ipMatches('41.90.1.5', 'not-an-ip/24'), false);
});

test('an empty list accepts every address', () => {
  assert.equal(isAllowed('8.8.8.8', []), true);
});

const run = (rules, ip) => {
  const reported = [];
  const original = gatewayWatch.reportRejectedCallback;
  gatewayWatch.reportRejectedCallback = (info) => reported.push(info);
  let error;
  callbackIpAllowlist(() => rules, 'Mamlaka')({ ip, originalUrl: '/callbacks/mamlaka?secret=x', socket: {} }, {}, (e) => { error = e; });
  gatewayWatch.reportRejectedCallback = original;
  return { error, reported };
};

test('a callback from an allowed address goes through', () => {
  const { error, reported } = run(['41.90.1.5'], '41.90.1.5');
  assert.equal(error, undefined);
  assert.equal(reported.length, 0);
});

test('a callback from any other address is refused and reported, without the secret', () => {
  const { error, reported } = run(['41.90.1.5'], '105.160.56.198');
  assert.equal(error.statusCode, 403);
  assert.deepEqual(reported, [{ ip: '105.160.56.198', provider: 'Mamlaka', path: '/callbacks/mamlaka' }]);
});
