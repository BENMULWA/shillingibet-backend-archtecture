'use strict';

const { z } = require('zod');

const selection = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  odds: z.coerce.number().min(1.01),
});

const create = z.object({
  sport: z.string().min(1),
  league: z.string().optional(),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  startTime: z.coerce.date(),
  selections: z.array(selection).min(2),
});

const settle = z.object({
  result: z.string().min(1),
});

const list = z.object({
  sport: z.string().optional(),
  status: z.enum(['scheduled', 'live', 'finished', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { create, settle, list };
