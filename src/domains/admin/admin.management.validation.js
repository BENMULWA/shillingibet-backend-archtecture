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

const monthlyAnalytics = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});

const recentActivity = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const pagination = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user ID');

const phoneSearch = z
  .string()
  .trim()
  .regex(/^\+?\d{4,15}$/, 'Invalid phone search')
  .optional();

const listUsers = z.object({
  ...pagination,
  phone: phoneSearch,
  status: z.enum(['active', 'suspended']).optional(),
});

const fraudAlerts = z.object({ ...pagination });
const fraudStats = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
const fraudAlertParams = z.object({
  alertId: z.string().regex(/^(referral|welcome):[a-f\d]{24}$/i, 'Invalid bonus alert ID'),
});
const fraudUserParams = z.object({ userId: objectId });
const resolveFraudAlert = z.object({
  status: z.enum(['resolved_legitimate', 'resolved_fraud']),
  resolutionNotes: z.string().trim().max(500).optional(),
});

const listTransactions = z.object({
  ...pagination,
  phone: phoneSearch,
  type: z.enum([
    'deposit',
    'withdrawal',
    'internal_allocation',
    'internal_withdrawal_reserve',
    'internal_withdrawal_release',
  ]).optional(),
  status: z.enum(['pending', 'submission_unknown', 'manual_review', 'completed', 'failed', 'expired']).optional(),
});

const listBets = z.object({
  ...pagination,
  phone: phoneSearch,
  status: z.enum(['open', 'won', 'lost', 'void']).optional(),
  source: z.enum(['sportsbook', 'virtual']).optional(),
});

const userControls = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    depositPaused: z.boolean().optional(),
    withdrawalPaused: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one account control is required',
  });

const createStaff = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+?254|0)?[71]\d{8}$/, 'Invalid Kenyan phone number'),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().optional(),
  adminLevel: z.enum(['support', 'admin', 'super_admin']),
});

const listStaff = z.object({
  ...pagination,
  phone: phoneSearch,
  status: z.enum(['active', 'suspended']).optional(),
  adminLevel: z.enum(['support', 'admin', 'super_admin']).optional(),
});
const staffParams = z.object({ id: objectId });

const manageStaff = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  adminLevel: z.enum(['support', 'admin', 'super_admin']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one staff change is required',
});

const exportRange = z
  .object({
    dateFrom: z.coerce.date(),
    dateTo: z.coerce.date(),
    phone: phoneSearch,
    status: z.string().trim().min(1).max(30).optional(),
    source: z.enum(['sportsbook', 'virtual']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom > value.dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateFrom'],
        message: 'dateFrom must be before or equal to dateTo',
      });
    }
    if (value.dateTo.getTime() - value.dateFrom.getTime() > 366 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTo'],
        message: 'Export range cannot exceed 366 days',
      });
    }
  });

const zeroBalance = z.object({
  reason: z.string().trim().min(5, 'A reason of at least 5 characters is required').max(500),
}).strict();

const reconcileVirtualBet = z.object({
  betId: z.string().min(1),
  gameUuid: z.string().min(1).optional(),
});

const transactionParams = z.object({ transactionId: objectId });
const manualWithdrawalResolution = z.object({
  status: z.enum(['completed', 'failed']),
  providerReference: z.string().trim().min(3).max(160),
  reason: z.string().trim().min(10).max(500),
  providerConfirmed: z.literal(true),
}).strict();

const treasuryAllocation = z.object({
  amount: z.coerce.number().positive().max(100000000),
  idempotencyKey: z.string().trim().min(8).max(100),
  note: z.string().trim().max(240).optional(),
});

const treasuryMovements = z.object({
  ...pagination,
});

const cashbackAwards = z.object({
  ...pagination,
  phone: phoneSearch,
});

const uuid = z.string().uuid();
const freeBetCampaignParams = z.object({ campaignId: uuid });
const freeBetAwardParams = z.object({ freeBetId: uuid });

const createFreeBetCampaign = z
  .object({
    gameUuid: z.string().trim().min(1).max(120),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(1).max(500),
    currency: z.string().trim().length(3).toUpperCase().default('KES'),
    amount: z.coerce.number().positive().max(1000000),
    countPerPlayer: z.coerce.number().int().positive().max(100),
    minimumMultiplier: z.coerce.number().positive().max(100000),
    deductStakeOnWin: z.boolean(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    validity: z.coerce.number().int().positive().max(8760),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endDate <= value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be later than startDate',
      });
    }
  });

const listFreeBetCampaigns = z.object({
  gameUuid: z.string().trim().min(1).max(120).optional(),
  status: z.coerce.number().int().refine((value) => [1, 3].includes(value), 'Invalid campaign status').optional(),
  page: pagination.page,
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

const updateFreeBetCampaignStatus = z.object({
  status: z.coerce.number().int().refine((value) => [1, 3].includes(value), 'Status must be 1 or 3'),
});

const awardFreeBets = z.object({
  userIds: z.array(objectId).min(1).max(100).refine(
    (values) => new Set(values).size === values.length,
    'Duplicate user IDs are not allowed'
  ),
});

const listFreeBetAwards = z.object({
  campaignId: uuid.optional(),
  playerId: objectId.optional(),
  status: z.coerce.number().int().min(1).max(7).optional(),
  page: pagination.page,
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

const revokeFreeBet = z.object({
  reason: z.string().trim().min(2).max(240),
});

const listFreeBetAudit = z.object({
  action: z.enum(['campaign_create', 'campaign_status', 'award_create', 'award_revoke']).optional(),
  outcome: z.enum(['success', 'failed']).optional(),
  campaignId: uuid.optional(),
  ...pagination,
});

const listFreeBetUsers = z.object({
  ...pagination,
  search: z.string().trim().min(2).max(80).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

const auditList = z.object({
  ...pagination,
  action: z.string().trim().max(160).optional(),
  category: z.enum(['write', 'read', 'export']).optional(),
  outcome: z.enum(['success', 'failed']).optional(),
  actor: objectId.optional(),
  targetUser: objectId.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
const authEventList = z.object({
  ...pagination,
  type: z.string().trim().max(60).optional(),
  outcome: z.enum(['success', 'failed', 'denied']).optional(),
});
const auditDateParams = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date') });
const auditUserParams = z.object({ userId: objectId });

module.exports = {
  zeroBalance,
  overview,
  monthlyAnalytics,
  recentActivity,
  listUsers,
  fraudAlerts,
  fraudStats,
  fraudAlertParams,
  fraudUserParams,
  resolveFraudAlert,
  listTransactions,
  listBets,
  userControls,
  createStaff,
  listStaff,
  staffParams,
  manageStaff,
  exportRange,
  reconcileVirtualBet,
  transactionParams,
  manualWithdrawalResolution,
  treasuryAllocation,
  treasuryMovements,
  cashbackAwards,
  freeBetCampaignParams,
  freeBetAwardParams,
  createFreeBetCampaign,
  listFreeBetCampaigns,
  updateFreeBetCampaignStatus,
  awardFreeBets,
  listFreeBetAwards,
  revokeFreeBet,
  listFreeBetAudit,
  listFreeBetUsers,
  auditList,
  authEventList,
  auditDateParams,
  auditUserParams,
};
