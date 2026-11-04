'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

const servicePath = require.resolve('../src/domains/user/user.service');

const load = () => {
  const originalLoad = Module._load;
  const sent = [];
  const events = [];
  const doc = {
    _id: { toString: () => 'staff1' },
    phone: '254712345678',
    role: 'admin',
    isStaff: true,
    adminLevel: 'super_admin',
    status: 'active',
    phoneVerified: true,
    staffLoginChallenge: {},
    comparePassword: async (pw) => pw === 'correct-password',
    save: async () => {},
    toJSON() { return { phone: this.phone, adminLevel: this.adminLevel }; },
  };
  const User = {
    findOne() {
      const result = Promise.resolve(doc);
      result.lean = async () => doc;
      return { select: () => result };
    },
    async findOneAndUpdate(filter, update) {
      const c = doc.staffLoginChallenge;
      const ok = filter['staffLoginChallenge.challengeId'] === c.challengeId
        && filter['staffLoginChallenge.codeHash'] === c.codeHash
        && c.expiresAt > new Date() && !c.consumedAt && c.attemptsRemaining > 0;
      if (!ok) return null;
      c.consumedAt = update.$set['staffLoginChallenge.consumedAt'];
      return doc;
    },
    async updateOne() { return {}; },
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../../config') {
        return { jwt: { secret: 'secret', expiresIn: '1h' }, sms: { staffLoginCodeTtlMinutes: 10 } };
      }
      if (request === './user.model') return User;
      if (request === '../../services/sms.service') {
        return { sendStaffLoginCode: async ({ phone, code }) => { sent.push({ phone, code }); } };
      }
      if (request === '../admin/authEvent.service') {
        return { record: async (event) => { events.push(event.type); } };
      }
      if (request === '../../utils/db') return {};
      if (request === '../../middlewares/auth') {
        return { isStaffUser: (u) => Boolean(u.isStaff), getStaffLevel: (u) => u.adminLevel };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  const service = require(servicePath);
  Module._load = originalLoad;
  return { service, sent, events, doc };
};

test('staff sign-in sends an SMS code and issues no token until it is verified', async () => {
  const { service, sent } = load();
  const result = await service.staffLogin({ phone: '0712345678', password: 'correct-password' });
  assert.equal(result.verificationRequired, true);
  assert.equal(result.token, undefined);
  assert.equal(result.maskedPhone, '******5678');
  assert.equal(sent.length, 1);
  assert.match(sent[0].code, /^\d{6}$/);
});

test('the right code returns a token flagged mfa, once only', async () => {
  const { service, sent } = load();
  const { challengeId } = await service.staffLogin({ phone: '0712345678', password: 'correct-password' });
  const { token } = await service.verifyStaffLogin({ challengeId, code: sent[0].code });
  assert.equal(jwt.verify(token, 'secret').mfa, true);
  await assert.rejects(service.verifyStaffLogin({ challengeId, code: sent[0].code }), /invalid, expired, or already used/);
});

test('a wrong code is rejected', async () => {
  const { service } = load();
  const { challengeId } = await service.staffLogin({ phone: '0712345678', password: 'correct-password' });
  await assert.rejects(service.verifyStaffLogin({ challengeId, code: '000000' }), /invalid, expired, or already used/);
});

test('a wrong password sends no code', async () => {
  const { service, sent } = load();
  await assert.rejects(service.staffLogin({ phone: '0712345678', password: 'nope' }), /Invalid phone or password/);
  assert.equal(sent.length, 0);
});
