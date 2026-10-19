'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const ApiError = require('../../utils/ApiError');
const config = require('../../config');
const service = require('./wallet.service');
const schemas = require('./wallet.validation');

const billOrder = asyncHandler(async (req, res) => {
  const result = await service.createBillOrder(req.user, req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Comet bill order created',
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

const cometWebhook = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    throw ApiError.badRequest('Invalid Comet callback JSON');
  }

  const parsed = schemas.callback.safeParse(payload);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid Comet callback payload', parsed.error.flatten());
  }

  const eventHeader = req.get('X-Comet-Event');
  const clientHeader = req.get('X-Comet-Client');
  if (!eventHeader || eventHeader !== parsed.data.event) {
    throw ApiError.badRequest('Comet callback event header does not match payload');
  }
  if (
    clientHeader !== config.comet.clientId ||
    parsed.data.client_id !== config.comet.clientId ||
    parsed.data.direction !== 'debit'
  ) {
    throw ApiError.unauthorized('Comet callback client or direction is invalid');
  }
  if (!['bill_order.approved', 'bill_order.declined'].includes(eventHeader)) {
    throw ApiError.badRequest('Unsupported Comet debit callback event');
  }

  const result = await service.handleCallback(parsed.data);
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

const testCredit = asyncHandler(async (req, res) => {
  const result = await service.testCreditWallet(req.user, req.body);
  sendSuccess(res, { message: 'Test credit applied', data: result });
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

module.exports = { billOrder, cardLink, cometWebhook, celoDeposit, celoSync, celoWithdraw, celoWebhook, testCredit };
