'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const limiters = require('../src/middlewares/rateLimiter');

const run = (middleware, body) =>
  new Promise((resolve, reject) => {
    const req = { ip: '203.0.113.7', method: 'POST', path: '/users/staff-login', body, headers: {}, app: { get: () => false }, get: () => undefined };
    const res = { headers: {}, setHeader() {}, getHeader() {}, set() { return this; }, status() { return this; }, json() { return this; }, on() {}, once() {}, removeListener() {} };
    middleware(req, res, (err) => (err ? reject(err) : resolve('passed')));
  });

test('staff sign-in limiters build a key without throwing and let the first request through', async () => {
  assert.equal(await run(limiters.staffLoginLimiter, { phone: '0712345678', password: 'x' }), 'passed');
  assert.equal(
    await run(limiters.staffLoginVerificationLimiter, { challengeId: '11111111-1111-4111-8111-111111111111', code: '123456' }),
    'passed'
  );
  assert.equal(await run(limiters.staffLoginResendLimiter, { challengeId: '11111111-1111-4111-8111-111111111111' }), 'passed');
});
