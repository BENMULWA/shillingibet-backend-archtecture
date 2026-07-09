'use strict';

const crypto = require('crypto');

const md5Hex = (input) => crypto.createHash('md5').update(input).digest('hex');
const sha1Hex = (input) => crypto.createHash('sha1').update(input).digest('hex');

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const sortNestedArray = (array) => {
  const sorted = [...array].sort();
  return sorted.map((value) => {
    if (Array.isArray(value)) return sortNestedArray(value);
    if (isPlainObject(value)) return sortNestedObject(value);
    return value;
  });
};

const sortNestedObject = (obj) =>
  Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      const value = obj[key];
      if (Array.isArray(value)) {
        acc[key] = sortNestedArray(value);
      } else if (isPlainObject(value)) {
        acc[key] = sortNestedObject(value);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});

const buildHashKey = (request) => {
  const parts = [];
  const keys = Object.keys(request || {}).sort();

  for (const key of keys) {
    const value = request[key];

    if (isPlainObject(value)) {
      const sortedValue = sortNestedObject(value);
      const nestedKeys = Object.keys(sortedValue);
      for (const nk of nestedKeys) {
        parts.push(`${nk}=${md5Hex(JSON.stringify(sortedValue[nk]))}`);
      }
    } else if (Array.isArray(value)) {
      const sortedValue = sortNestedArray(value);
      sortedValue.forEach((item, index) => {
        parts.push(`${index}=${md5Hex(JSON.stringify(item))}`);
      });
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }

  return parts.join('&');
};

const createSignature = (request, suffixKey) =>
  md5Hex(buildHashKey(request) + suffixKey);

const generateToken = (appKey, timestamp) =>
  md5Hex(sha1Hex(`${appKey}${timestamp}`));

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

module.exports = { buildHashKey, createSignature, generateToken, safeEqual };
