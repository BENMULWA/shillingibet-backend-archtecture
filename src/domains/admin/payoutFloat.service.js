'use strict';

const ApiError = require('../../utils/ApiError');
const smsService = require('../../services/sms.service');
const PayoutFloat = require('./payoutFloat.model');

const FLOAT_ID = 'payout-float';
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const config = require('../../config');

const ensurePayoutFloat = async () => {
  try {
    return await PayoutFloat.findByIdAndUpdate(
      FLOAT_ID,
      { $setOnInsert: { _id: FLOAT_ID } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return PayoutFloat.findById(FLOAT_ID).lean();
  }
};

const getPayoutFloat = async () => {
  const payoutFloat = await ensurePayoutFloat();
  return {
    balance: Number(payoutFloat?.balance || 0),
    currency: 'KES',
    totalAllocated: Number(payoutFloat?.totalAllocated || 0),
    reserved: (payoutFloat?.reservations || []).reduce(
      (total, reservation) => total + Number(reservation.amount || 0),
      0
    ),
  };
};

const allocatePayoutFloat = async ({ amount, idempotencyKey, actorId }) => {
  await ensurePayoutFloat();
  const key = String(idempotencyKey || '').trim();
  const amountToAllocate = Number(Number(amount).toFixed(2));

  const payoutFloat = await PayoutFloat.findByIdAndUpdate(
    FLOAT_ID,
    [
      {
        $set: {
          _allocationSeen: {
            $in: [key, { $ifNull: ['$allocationKeys', []] }],
          },
        },
      },
      {
        $set: {
          balance: {
            $add: [
              { $ifNull: ['$balance', 0] },
              { $cond: ['$_allocationSeen', 0, amountToAllocate] },
            ],
          },
          totalAllocated: {
            $add: [
              { $ifNull: ['$totalAllocated', 0] },
              { $cond: ['$_allocationSeen', 0, amountToAllocate] },
            ],
          },
          allocationKeys: {
            $cond: [
              '$_allocationSeen',
              { $ifNull: ['$allocationKeys', []] },
              {
                $slice: [
                  { $concatArrays: [{ $ifNull: ['$allocationKeys', []] }, [key]] },
                  -500,
                ],
              },
            ],
          },
          updatedBy: {
            $cond: ['$_allocationSeen', '$updatedBy', { $toObjectId: String(actorId) }],
          },
        },
      },
      { $unset: '_allocationSeen' },
    ],
    { new: true }
  ).lean();

  return {
    balance: Number(payoutFloat.balance || 0),
    currency: 'KES',
    totalAllocated: Number(payoutFloat.totalAllocated || 0),
  };
};

const reservePayout = async ({ reference, amount }) => {
  await ensurePayoutFloat();
  const reservation = await PayoutFloat.findOneAndUpdate(
    {
      _id: FLOAT_ID,
      balance: { $gte: amount },
      'reservations.reference': { $ne: reference },
    },
    {
      $inc: { balance: -amount },
      $push: { reservations: { reference, amount } },
    },
    { new: true }
  ).lean();

  if (reservation) {
    return { reserved: true, balance: Number(reservation.balance || 0) };
  }

  const currentFloat = await PayoutFloat.findById(FLOAT_ID).lean();
  const existingReservation = (currentFloat?.reservations || []).find(
    (entry) => entry.reference === reference
  );
  return {
    reserved: Boolean(existingReservation),
    balance: Number(currentFloat?.balance || 0),
    alreadyReserved: Boolean(existingReservation),
  };
};

const settlePayout = async (reference, { refund = false } = {}) => {
  const payoutFloat = await PayoutFloat.findOneAndUpdate(
    { _id: FLOAT_ID, reservations: { $elemMatch: { reference } } },
    [
      {
        $set: {
          balance: {
            $add: [
              { $ifNull: ['$balance', 0] },
              refund
                ? {
                    $let: {
                      vars: {
                        reservation: {
                          $first: {
                            $filter: {
                              input: { $ifNull: ['$reservations', []] },
                              as: 'entry',
                              cond: { $eq: ['$$entry.reference', reference] },
                            },
                          },
                        },
                      },
                      in: { $ifNull: ['$$reservation.amount', 0] },
                    },
                  }
                : 0,
            ],
          },
          reservations: {
            $filter: {
              input: { $ifNull: ['$reservations', []] },
              as: 'entry',
              cond: { $ne: ['$$entry.reference', reference] },
            },
          },
        },
      },
    ],
    { new: true }
  ).lean();

  return Boolean(payoutFloat);
};

const alertPayoutContact = async ({ amount, available, user }) => {
  const now = new Date();
  const claim = await PayoutFloat.findOneAndUpdate(
    {
      _id: FLOAT_ID,
      $or: [
        { lastLowBalanceAlertAt: null },
        { lastLowBalanceAlertAt: { $lte: new Date(now.getTime() - ALERT_COOLDOWN_MS) } },
      ],
    },
    { $set: { lastLowBalanceAlertAt: now } },
    { new: true }
  ).lean();
  if (!claim) return;

  const userName = String(user?.name || '').trim() || user?.phone || 'Unknown player';
  const message = `Bingwake alert: withdrawal by ${userName} was blocked. Requested KES ${amount.toLocaleString('en-KE')}, payout float available KES ${available.toLocaleString('en-KE')}. Top up the payout float in Settings.`;

  await Promise.all(
    config.liquidity.alertPhones.map((phone) =>
      smsService.safeSend({ phone, message, context: 'payout_float_low' })
    )
  );
};

const requirePayoutCapacity = async ({ reference, amount, user }) => {
  const result = await reservePayout({ reference, amount });
  if (result.reserved) return;

  await alertPayoutContact({ amount, available: result.balance, user });
  throw new ApiError(503,
    `Withdrawals are temporarily paused. kindly contact the Support team for assistance. Thank you for your patience.`
  );
};

module.exports = {
  allocatePayoutFloat,
  getPayoutFloat,
  requirePayoutCapacity,
  reservePayout,
  settlePayout,
};