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

module.exports = { overview, reconcileVirtualBet };
