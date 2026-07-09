'use strict';

const KE_PHONE_REGEX = /^(?:254|0)?7\d{8}$/;

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
};

const toLocalPhone = (phone) => {
  const normalized = normalizePhone(phone);
  if (normalized.startsWith('254') && normalized.length === 12) {
    return `0${normalized.slice(3)}`;
  }
  return normalized;
};

module.exports = { KE_PHONE_REGEX, normalizePhone, toLocalPhone };
