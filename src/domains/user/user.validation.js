'use strict';

const { z } = require('zod');
const { KE_PHONE_REGEX } = require('../../utils/phone');

const phone = z.string().regex(KE_PHONE_REGEX, 'Invalid Kenyan phone number');
const walletTypeValue = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'airtime' || normalized === 'airtimebalance' || normalized === 'airtimewallet') {
    return 'airtime';
  }
  if (normalized === 'balance' || normalized === 'kes' || normalized === 'mainwallet') {
    return 'balance';
  }

  return value;
}, z.enum(['balance', 'airtime']));

const register = z.object({
  phone,
  password: z.string().min(8).max(128),
  name: z.string().min(2).max(80).optional(),
  email: z.string().email().optional(),
  referralCode: z.string().trim().min(4).max(20).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid referral code').optional(),
});

const login = z.object({
  phone,
  password: z.string().min(1),
});

const verifyPhone = z.object({
  phone,
  code: z.string().regex(/^\d{4,8}$/, 'Verification code must be 4 to 8 digits'),
});

const resendPhoneCode = z.object({
  phone,
});

const requestPasswordReset = z.object({
  phone,
});

const resetPassword = z.object({
  phone,
  code: z.string().regex(/^\d{4,8}$/, 'Reset code must be 4 to 8 digits'),
  newPassword: z.string().min(8).max(128),
});

const staffAccess = z.object({
  isStaff: z.boolean(),
  adminLevel: z.enum(['support', 'admin', 'super_admin']).nullable().optional(),
});

const credit = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user id'),
  amount: z.coerce.number().positive().max(1_000_000),
  walletType: walletTypeValue.optional(),
});

const activeWallet = z.object({
  wallet: walletTypeValue,
});

module.exports = { register, login, verifyPhone, resendPhoneCode, requestPasswordReset, resetPassword, staffAccess, credit, activeWallet };
