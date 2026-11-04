'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const service = require('./admin.service');
const transactionService = require('../transaction/transaction.service');
const payoutFloatService = require('./payoutFloat.service');

const overview = asyncHandler(async (req, res) => {
  const data = await service.getOverview(req.query);
  sendSuccess(res, { data });
});

const monthly = asyncHandler(async (req, res) => {
  const data = await service.getMonthlyAnalytics(req.query);
  sendSuccess(res, { data });
});

const activity = asyncHandler(async (req, res) => {
  const data = await service.getRecentActivity(req.query);
  sendSuccess(res, { data });
});

const transactions = asyncHandler(async (req, res) => {
  const { items, ...meta } = await transactionService.listForAdmin(req.query);
  sendSuccess(res, { data: items, meta });
});

const getPayoutFloat = asyncHandler(async (_req, res) => {
  const data = await payoutFloatService.getPayoutFloat();
  sendSuccess(res, { data });
});

const allocatePayoutFloat = asyncHandler(async (req, res) => {
  const data = await payoutFloatService.allocatePayoutFloat({
    ...req.body,
    actorId: req.user._id,
  });
  sendSuccess(res, { message: 'Payout float allocated', data });
});

const reconcileVirtualBet = asyncHandler(async (req, res) => {
  const data = await service.reconcileVirtualBet(req.body);
  sendSuccess(res, { message: 'Virtual bet reconciled', data });
});

module.exports = {
  overview,
  monthly,
  activity,
  transactions,
  getPayoutFloat,
  allocatePayoutFloat,
  reconcileVirtualBet,
};
