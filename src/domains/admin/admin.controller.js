'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const service = require('./admin.service');

const overview = asyncHandler(async (req, res) => {
  const data = await service.getOverview(req.query);
  sendSuccess(res, { data });
});

const reconcileVirtualBet = asyncHandler(async (req, res) => {
  const data = await service.reconcileVirtualBet(req.body);
  sendSuccess(res, { message: 'Virtual bet reconciled', data });
});

module.exports = { overview, reconcileVirtualBet };
