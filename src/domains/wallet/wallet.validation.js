'use strict';

const { z } = require('zod');
const config = require('../../config');

const billOrder = z.object({
  amount: z.coerce
    .number()
    .min(config.limits.deposit.min, `Minimum deposit is ${config.limits.deposit.min}`)
    .max(config.limits.deposit.max, `Maximum deposit is ${config.limits.deposit.max}`),
  currency: z.string().trim().min(3).max(3).default(config.fusion.currency),
  comment: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  external_ref: z.string().trim().min(1).max(100).optional(),
  callback_url: z.string().trim().url().optional(),
  walletType: z.enum(['balance', 'airtime']).optional(),
});

const cardLink = z.object({
  amount: z.coerce
    .number()
    .min(config.limits.deposit.min, `Minimum deposit is ${config.limits.deposit.min}`)
    .max(config.limits.deposit.max, `Maximum deposit is ${config.limits.deposit.max}`),
  currency: z.string().trim().min(3).max(3).default(config.transactpay.currency),
  country: z.string().trim().min(2).max(2).default(config.transactpay.defaultCountry),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(5).max(30).optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  redirect_url: z.string().trim().url().optional(),
  external_ref: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(200).optional(),
  walletType: z.enum(['balance', 'airtime']).optional(),
});

const callback = z.object({
  amount: z.coerce.number().positive().optional(),
  comment_ref: z.string().trim().min(1).max(120).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  external_ref: z.string().trim().min(1).max(100).optional(),
  order_id: z.union([z.coerce.number().int().positive(), z.string().trim().min(1)]).optional(),
  payer_email: z.string().trim().email().optional(),
  status: z.string().trim().min(1),
  updated_at: z.string().trim().optional(),
  user_id: z.union([z.coerce.number().int().positive(), z.string().trim().min(1)]).optional(),
});

const celoWithdraw = z.object({
  amount: z.coerce.number().positive('Withdrawal amount must be greater than zero'),
  to_address: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Celo wallet address'),
  asset: z.enum(['cUSD', 'USDC', 'USDT']).optional(),
});

module.exports = { billOrder, cardLink, callback, celoWithdraw };
