'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  buildHashKey,
  createSignature,
} = require('../src/integrations/eurovirtuals/eurovirtuals.signature');

const md5Hex = (input) => crypto.createHash('md5').update(input).digest('hex');

test('buildHashKey matches the official nested sorting behavior', () => {
  const payload = {
    z: 'tail',
    data: {
      zebra: ['b', 'a'],
      alpha: {
        k2: 'two',
        k1: 'one',
      },
    },
    list: [
      { b: 2, a: 1 },
      ['z', 'a'],
    ],
    a: 'head',
  };

  const expected = [
    'a=head',
    `alpha=${md5Hex(JSON.stringify({ k1: 'one', k2: 'two' }))}`,
    `zebra=${md5Hex(JSON.stringify(['a', 'b']))}`,
    `0=${md5Hex(JSON.stringify({ a: 1, b: 2 }))}`,
    `1=${md5Hex(JSON.stringify(['a', 'z']))}`,
    'z=tail',
  ].join('&');

  assert.equal(buildHashKey(payload), expected);
});

test('createSignature appends the suffix key after building the sorted hash key', () => {
  const payload = {
    b: 2,
    a: 1,
  };

  const hashKey = 'a=1&b=2';
  assert.equal(createSignature(payload, 'suffix-key'), md5Hex(hashKey + 'suffix-key'));
});
