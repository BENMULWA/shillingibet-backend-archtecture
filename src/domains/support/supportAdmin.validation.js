'use strict';

const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user ID');

const agents = z.object({
  status: z.enum(['active', 'suspended', 'banned']).optional(),
});
const sessions = z.object({
  status: z.enum(['waiting', 'active', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Part of a phone number, e.g. 0714073826 or 3826.
  phone: z.string().trim().regex(/^\+?\d{3,15}$/, 'Enter at least 3 digits').optional(),
});
const agentParams = z.object({ userId: objectId });
const agentBan = z.object({
  accountId: z.string().trim().max(100).optional(),
  ban: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict();
const sessionParams = z.object({ sessionId: z.string().uuid() });

module.exports = {
  agents,
  sessions,
  agentParams,
  agentBan,
  sessionParams,
};
