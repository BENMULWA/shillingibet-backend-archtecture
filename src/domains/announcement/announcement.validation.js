'use strict';

const { z } = require('zod');

const create = z.object({
  title: z.string().trim().max(80).optional().default(''),
  message: z.string().trim().min(3, 'Write at least a few words').max(1000, 'Keep it under 1,000 characters'),
});

const list = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const params = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid announcement id') });

module.exports = { create, list, params };
