'use strict';

const { z } = require('zod');

const place = z.object({
  eventId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid event id'),
  selectionKey: z.string().min(1),
  stake: z.coerce.number().positive().max(100_000),
  walletType: z.enum(['balance', 'airtime']).optional(),
});

const list = z.object({
  status: z.enum(['open', 'won', 'lost', 'void']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { place, list };
