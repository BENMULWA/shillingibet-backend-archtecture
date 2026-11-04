'use strict';

// Back-office management: players, staff, bets, exports and account controls.
// Ported from the shilingi-back admin API; analytics, transactions and the payout
// float stay in admin.service.js / payoutFloat.service.js.

const ApiError = require('../../utils/ApiError');
const { getStaffLevel, isStaffUser } = require('../../middlewares/auth');
const { normalizePhone } = require('../../utils/phone');
const User = require('../user/user.model');
const Bet = require('../bet/bet.model');
const Event = require('../event/event.model');
const Transaction = require('../transaction/transaction.model');
const VirtualTxn = require('../virtual/virtualTxn.model');
const WelcomeBonusAward = require('../user/welcomeBonusAward.model');
const userService = require('../user/user.service');
const BalanceAdjustment = require('./balanceAdjustment.model');

const buildRange = (dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return null;
  const range = {};
  if (dateFrom) range.$gte = dateFrom;
  if (dateTo) range.$lte = dateTo;
  return range;
};

const normalizePhoneSearch = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
};

const pageResult = (items, total, page, limit) => ({
  items,
  total,
  page,
  limit,
  pages: Math.ceil(total / limit),
});

const listUsers = async ({ page, limit, phone, status }) => {
  const filter = { deletedAt: null };
  if (phone) filter.phone = { $regex: `^${normalizePhoneSearch(phone)}` };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    User.find(filter)
      .populate('referredBy', 'phone name referralCode')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const awards = items.length
    ? await WelcomeBonusAward.find({ user: { $in: items.map((item) => item._id) } })
      .select('user amount status reasons creditedAt reviewedAt reviewNotes')
      .lean()
    : [];
  const awardByUser = new Map(awards.map((award) => [String(award.user), award]));
  const enrichedItems = items.map((item) => {
    const award = awardByUser.get(String(item._id));
    if (award) return { ...item, welcomeBonusDetails: award };
    return {
      ...item,
      welcomeBonusDetails: {
        status: item.phoneVerified ? 'not_awarded' : 'not_eligible',
        amount: 0,
        reasons: [item.phoneVerified ? 'no_award_record' : 'phone_not_verified'],
        creditedAt: null,
        reviewedAt: null,
        reviewNotes: null,
      },
    };
  });

  return pageResult(enrichedItems, total, page, limit);
};

const createStaff = async ({ phone, password, name, email, adminLevel }) => {
  const normalizedPhone = normalizePhone(phone);
  const exists = await User.exists({ phone: normalizedPhone });
  if (exists) throw ApiError.conflict('Phone number already registered');

  const user = await User.create({
    phone: normalizedPhone,
    password,
    name,
    email,
    phoneVerified: true,
    role: 'admin',
    isStaff: true,
    adminLevel,
  });

  return user.toJSON();
};

const listStaff = async ({ page, limit, phone, status, adminLevel }) => {
  const filter = { isStaff: true, deletedAt: null };
  if (phone) filter.phone = { $regex: `^${normalizePhoneSearch(phone)}` };
  if (status) filter.status = status;
  if (adminLevel) filter.adminLevel = adminLevel;
  const [items, total] = await Promise.all([
    User.find(filter)
      .select('phone name email status adminLevel phoneVerified createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return pageResult(items, total, page, limit);
};

const assertStaffTarget = async (actor, staffId) => {
  if (String(actor._id) === String(staffId)) {
    throw ApiError.badRequest('You cannot change your own staff access');
  }
  const staff = await User.findOne({ _id: staffId, isStaff: true, deletedAt: null });
  if (!staff) throw ApiError.notFound('Staff account not found');
  return staff;
};

const manageStaff = async (actor, staffId, changes) => {
  const staff = await assertStaffTarget(actor, staffId);
  const removesActiveSuperAdmin = staff.adminLevel === 'super_admin' && staff.status === 'active' && (
    changes.status === 'suspended' ||
    (changes.adminLevel && changes.adminLevel !== 'super_admin')
  );
  if (removesActiveSuperAdmin) {
    const otherActiveSuperAdmins = await User.countDocuments({
      _id: { $ne: staff._id },
      isStaff: true,
      adminLevel: 'super_admin',
      status: 'active',
      deletedAt: null,
    });
    if (!otherActiveSuperAdmins) {
      throw ApiError.conflict('At least one active super admin must remain');
    }
  }
  const diff = Object.fromEntries(
    Object.keys(changes).map((key) => [key, { before: staff[key], after: changes[key] }])
  );
  Object.assign(staff, changes);
  await staff.save();
  return { staff: staff.toJSON(), changes: diff };
};

const sendStaffPasswordReset = async (actor, staffId) => {
  const staff = await assertStaffTarget(actor, staffId);
  await userService.requestPasswordReset({ phone: staff.phone });
  return { phone: staff.phone };
};

const exportDateFilter = ({ dateFrom, dateTo }) => ({
  createdAt: { $gte: dateFrom, $lte: dateTo },
});

async function* exportUsers({ dateFrom, dateTo, phone, status }) {
  const filter = { deletedAt: null, ...exportDateFilter({ dateFrom, dateTo }) };
  if (phone) filter.phone = { $regex: `^${normalizePhoneSearch(phone)}` };
  if (status && ['active', 'suspended'].includes(status)) filter.status = status;

  const cursor = User.find(filter)
    .populate('referredBy', 'phone')
    .sort({ createdAt: -1 })
    .lean()
    .cursor();

  for await (const user of cursor) {
    yield [
      user.phone,
      user.name,
      user.email,
      user.status,
      user.isStaff,
      user.adminLevel,
      user.balance,
      user.referredBy?.phone,
      user.createdAt,
    ];
  }
}

async function* exportTransactions({ dateFrom, dateTo, phone, status }) {
  const filter = exportDateFilter({ dateFrom, dateTo });
  if (phone) filter.phone = { $regex: `^${normalizePhoneSearch(phone)}` };
  if (status && ['pending', 'completed', 'failed', 'expired'].includes(status)) {
    filter.status = status;
  }

  const cursor = Transaction.find(filter).sort({ createdAt: -1 }).lean().cursor();
  for await (const transaction of cursor) {
    yield [
      transaction.receipt || transaction.externalId,
      transaction.phone,
      transaction.type,
      transaction.status,
      transaction.amount,
      transaction.taxAmount,
      transaction.netAmount,
      transaction.currency,
      transaction.provider,
      transaction.createdAt,
      transaction.completedAt,
    ];
  }
}

async function* exportBets({ dateFrom, dateTo, phone, status, source }) {
  const pipeline = await buildUnifiedBetPipeline({
    phone,
    status,
    source,
    dateFrom,
    dateTo,
  });
  const cursor = Bet.aggregate([...pipeline, { $sort: { createdAt: -1, _id: -1 } }]).cursor();

  for await (const bet of cursor) {
    yield [
      bet.source,
      bet.betId,
      bet.user?.phone,
      bet.game,
      bet.selectionLabel,
      bet.odds,
      bet.stake,
      bet.payout,
      bet.status,
      bet.createdAt,
      bet.settledAt,
    ];
  }
}

const assertCanManageUser = async (actor, userId) => {
  if (String(actor._id) === String(userId)) {
    throw ApiError.badRequest('You cannot apply this action to your own account');
  }

  const target = await User.findOne({ _id: userId, deletedAt: null });
  if (!target) throw ApiError.notFound('User not found');
  if (isStaffUser(target) && getStaffLevel(actor) !== 'super_admin') {
    throw ApiError.forbidden('Only super admins can manage staff accounts');
  }
  return target;
};

const updateUserControls = async (actor, userId, controls) => {
  const target = await assertCanManageUser(actor, userId);
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: controls },
    { new: true, runValidators: true }
  ).lean();
  const changes = Object.fromEntries(
    Object.keys(controls).map((key) => [key, { before: target[key], after: user[key] }])
  );
  return { user, changes };
};

const zeroUserBalance = async (actor, userId, reason) => {
  await assertCanManageUser(actor, userId);
  const before = await User.findOneAndUpdate(
    { _id: userId, deletedAt: null },
    { $set: { balance: 0, bonusBalance: 0 } },
    { new: false, runValidators: true }
  ).lean();
  if (!before) throw ApiError.notFound('User not found');

  const adjustment = await BalanceAdjustment.create({
    type: 'admin_zero_balance',
    user: before._id,
    actor: actor._id,
    amount: -((before.balance || 0) + (before.bonusBalance || 0)),
    balanceBefore: before.balance || 0,
    balanceAfter: 0,
    bonusBalanceBefore: before.bonusBalance || 0,
    bonusBalanceAfter: 0,
    reason,
  });
  return { user: { ...before, balance: 0, bonusBalance: 0 }, adjustment };
};

const deleteUser = async (actor, userId) => {
  const target = await assertCanManageUser(actor, userId);
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        status: 'suspended',
        depositPaused: true,
        withdrawalPaused: true,
        isStaff: false,
        adminLevel: null,
        role: 'user',
        deletedAt: new Date(),
      },
    }
  );
  return {
    phone: target.phone,
    status: { before: target.status, after: 'suspended' },
    balance: target.balance,
    bonusBalance: target.bonusBalance,
  };
};

const buildUnifiedBetPipeline = async ({ phone, status, source, dateFrom, dateTo }) => {
  const userMatch = phone
    ? { phone: { $regex: `^${normalizePhoneSearch(phone)}` } }
    : {};
  const userIds = phone ? await User.find(userMatch).distinct('_id') : null;
  const sportsbookMatch = {};
  const virtualMatch = { action: 'place_bet' };
  if (userIds) {
    sportsbookMatch.user = { $in: userIds };
    virtualMatch.user = { $in: userIds };
  }
  const range = buildRange(dateFrom, dateTo);
  if (range) {
    sportsbookMatch.createdAt = range;
    virtualMatch.createdAt = range;
  }
  if (status) sportsbookMatch.status = status;

  const userLookup = [
    { $lookup: { from: User.collection.name, localField: 'user', foreignField: '_id', as: 'userInfo' } },
    { $set: { user: { $arrayElemAt: ['$userInfo', 0] } } },
    { $unset: 'userInfo' },
  ];

  const sportsbookPipeline = [
    { $match: sportsbookMatch },
    {
      $lookup: {
        from: Event.collection.name,
        localField: 'event',
        foreignField: '_id',
        as: 'eventInfo',
      },
    },
    {
      $project: {
        _id: 1,
        betId: { $toString: '$_id' },
        source: { $literal: 'sportsbook' },
        user: 1,
        game: {
          $concat: [
            { $ifNull: ['$placementSnapshot.homeTeam', { $ifNull: [{ $arrayElemAt: ['$eventInfo.homeTeam', 0] }, 'Unknown'] }] },
            ' vs ',
            { $ifNull: ['$placementSnapshot.awayTeam', { $ifNull: [{ $arrayElemAt: ['$eventInfo.awayTeam', 0] }, 'Unknown'] }] },
          ],
        },
        selectionLabel: 1,
        odds: 1,
        stake: 1,
        potentialPayout: 1,
        payout: { $cond: [{ $eq: ['$status', 'won'] }, '$potentialPayout', 0] },
        status: 1,
        currency: { $literal: 'KES' },
        balanceAfter: { $literal: null },
        createdAt: 1,
        settledAt: 1,
        settlementHistory: 1,
      },
    },
    ...userLookup,
  ];

  const virtualPipeline = [
    { $match: virtualMatch },
    {
      $lookup: {
        from: VirtualTxn.collection.name,
        let: { placedBetId: '$betId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$betId', '$$placedBetId'] },
                  { $in: ['$action', ['result_bet', 'result_freebet', 'rollback_bet']] },
                ],
              },
            },
          },
          { $sort: { createdAt: -1 } },
        ],
        as: 'outcomes',
      },
    },
    {
      $set: {
        latestOutcome: { $arrayElemAt: ['$outcomes', 0] },
        hasRollback: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: '$outcomes',
                  as: 'outcome',
                  cond: { $eq: ['$$outcome.action', 'rollback_bet'] },
                },
              },
            },
            0,
          ],
        },
        resultOutcome: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$outcomes',
                as: 'outcome',
                cond: { $in: ['$$outcome.action', ['result_bet', 'result_freebet']] },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 1,
        betId: 1,
        source: { $literal: 'virtual' },
        user: 1,
        game: { $ifNull: ['$gameName', '$gameUuid'] },
        selectionLabel: { $ifNull: ['$type', 'Virtual bet'] },
        odds: { $literal: null },
        stake: '$amount',
        potentialPayout: { $ifNull: ['$resultOutcome.payout', 0] },
        payout: { $ifNull: ['$resultOutcome.payout', 0] },
        status: {
          $switch: {
            branches: [
              { case: '$hasRollback', then: 'void' },
              {
                case: { $gt: [{ $ifNull: ['$resultOutcome.payout', 0] }, 0] },
                then: 'won',
              },
              { case: { $ne: [{ $type: '$resultOutcome' }, 'missing'] }, then: 'lost' },
            ],
            default: 'open',
          },
        },
        currency: 1,
        balanceAfter: 1,
        createdAt: 1,
        settledAt: '$latestOutcome.createdAt',
        settlementHistory: {
          $map: {
            input: '$outcomes',
            as: 'outcome',
            in: {
              status: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$$outcome.action', 'rollback_bet'] }, then: 'void' },
                    { case: { $gt: ['$$outcome.payout', 0] }, then: 'won' },
                  ],
                  default: 'lost',
                },
              },
              payout: { $ifNull: ['$$outcome.payout', 0] },
              settledAt: '$$outcome.createdAt',
              source: { $literal: 'provider_callback' },
              referenceId: '$$outcome.referenceId',
            },
          },
        },
      },
    },
    ...(status ? [{ $match: { status } }] : []),
    ...userLookup,
  ];

  if (source === 'sportsbook') return sportsbookPipeline;
  if (source === 'virtual') {
    return [
      { $match: { _id: null } },
      { $unionWith: { coll: VirtualTxn.collection.name, pipeline: virtualPipeline } },
    ];
  }
  return [
    ...sportsbookPipeline,
    { $unionWith: { coll: VirtualTxn.collection.name, pipeline: virtualPipeline } },
  ];
};

const listBets = async ({ page, limit, phone, status, source }) => {
  const pipeline = await buildUnifiedBetPipeline({ phone, status, source });
  const [result] = await Bet.aggregate([
    ...pipeline,
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        count: [{ $count: 'total' }],
      },
    },
  ]);
  return pageResult(result?.items || [], result?.count?.[0]?.total || 0, page, limit);
};
module.exports = {
  listUsers,
  listBets,
  createStaff,
  listStaff,
  manageStaff,
  sendStaffPasswordReset,
  exportUsers,
  exportTransactions,
  exportBets,
  updateUserControls,
  zeroUserBalance,
  deleteUser,
};
