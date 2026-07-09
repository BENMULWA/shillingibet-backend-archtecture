'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const service = require('./transaction.service');

const deposit = asyncHandler(async (req, res) => {
  const payload = { ...req.body, phone: req.body.phone || req.user.phone };
  const txn = await service.deposit(req.user, payload);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Deposit initiated, approve the prompt on your phone',
    data: txn,
  });
});

const withdraw = asyncHandler(async (req, res) => {
  const payload = { ...req.body, phone: req.body.phone || req.user.phone };
  const txn = await service.withdraw(req.user, payload);
  sendSuccess(res, { statusCode: 201, message: 'Withdrawal is being processed', data: txn });
});

const list = asyncHandler(async (req, res) => {
  const { items, ...meta } = await service.listForUser(req.user._id, req.query);
  sendSuccess(res, { data: items, meta });
});

const getById = asyncHandler(async (req, res) => {
  const txn = await service.getById(req.user._id, req.params.id);
  sendSuccess(res, { data: txn });
});

const callback = asyncHandler(async (req, res) => {
  const result = await service.handleCallback(req.params.type, req.body);
  res.status(200).json({ success: true, ...result });
});

module.exports = { deposit, withdraw, list, getById, callback };
