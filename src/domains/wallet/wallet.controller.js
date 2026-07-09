'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
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

module.exports = { billOrder, cardLink, callback };
