'use strict';

const { z } = require('zod');

const overview = z
  .object({
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateFrom'],
        message: 'dateFrom must be before or equal to dateTo',
      });
    }
  });

const reconcileVirtualBet = z.object({
  betId: z.string().min(1),
  gameUuid: z.string().min(1).optional(),
});

const transactions = z.object({
  type: z.enum(['deposit', 'withdrawal']).optional(),
  status: z.enum(['pending', 'completed', 'failed', 'expired']).optional(),
  phone: z.string().trim().min(5).max(20).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

const monthly = z.object({
  months: z.coerce.number().int().positive().max(24).default(12),
});

const activity = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30),
});

const payoutFloatAllocation = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  idempotencyKey: z.string().trim().min(8).max(128),
  note: z.string().trim().max(200).optional(),
});

module.exports = {
  overview,
  reconcileVirtualBet,
  transactions,
  monthly,
  activity,
  payoutFloatAllocation,
};
