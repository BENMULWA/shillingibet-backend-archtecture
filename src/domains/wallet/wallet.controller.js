'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const ApiError = require('../../utils/ApiError');
const service = require('./wallet.service');

const billOrder = asyncHandler(async (req, res) => {
  const result = await service.createBillOrder(req.user, req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Fusion bill order created',
    data: result,
  });
});

const cardLink = asyncHandler(async (req, res) => {
  const result = await service.createCardPaymentLink(req.user, req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Card payment link created',
    data: result,
  });
});

const callback = asyncHandler(async (req, res) => {
  const result = await service.handleCallback(req.body);
  res.status(200).json({ success: true, ...result });
});

const celoDeposit = asyncHandler(async (req, res) => {
  const result = await service.getCeloDepositInstructions(req.user, req.query.asset);
  sendSuccess(res, { data: result });
});

const celoSync = asyncHandler(async (req, res) => {
  const result = await service.syncCeloDeposit(req.user, req.query.asset);
  sendSuccess(res, { data: result });
});

const celoWithdraw = asyncHandler(async (req, res) => {
  const result = await service.withdrawCelo(req.user, req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Valora withdrawal submitted',
    data: result,
  });
});

const celoWebhook = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    throw ApiError.badRequest('Invalid JSON webhook payload');
  }

  const result = await service.handleCeloWebhook(payload);
  res.status(200).json({ success: true, ...result });
});

module.exports = { billOrder, cardLink, callback, celoDeposit, celoSync, celoWithdraw, celoWebhook };
