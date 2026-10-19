'use strict';

const { z } = require('zod');
const config = require('../../config');
const { KE_PHONE_REGEX } = require('../../utils/phone');

const phone = z.string().regex(KE_PHONE_REGEX, 'Invalid Kenyan phone number').optional();

const deposit = z.object({
  amount: z.coerce
    .number()
    .min(config.limits.deposit.min, `Minimum deposit is ${config.limits.deposit.min}`)
    .max(config.limits.deposit.max, `Maximum deposit is ${config.limits.deposit.max}`),
  phone,
  provider: z.string().optional(),
  walletType: z.enum(['balance', 'airtime']).optional(),
});

const withdraw = z.object({
  amount: z.coerce
    .number()
    .min(config.limits.withdrawal.min, `Minimum withdrawal is ${config.limits.withdrawal.min}`)
    .max(config.limits.withdrawal.max, `Maximum withdrawal is ${config.limits.withdrawal.max}`),
  phone,
  provider: z.string().optional(),
  walletType: z.enum(['balance', 'airtime']).optional(),
});

const list = z.object({
  type: z.enum(['deposit', 'withdrawal']).optional(),
  status: z.enum(['pending', 'completed', 'failed', 'expired']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { deposit, withdraw, list };
