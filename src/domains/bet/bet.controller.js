'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const betService = require('./bet.service');

const place = asyncHandler(async (req, res) => {
  const bet = await betService.place(req.user, req.body);
  sendSuccess(res, { statusCode: 201, message: 'Bet placed', data: bet });
});

const list = asyncHandler(async (req, res) => {
  const { items, ...meta } = await betService.listForUser(req.user._id, req.query);
  sendSuccess(res, { data: items, meta });
});

const getById = asyncHandler(async (req, res) => {
  const bet = await betService.getById(req.user._id, req.params.id);
  sendSuccess(res, { data: bet });
});

module.exports = { place, list, getById };
