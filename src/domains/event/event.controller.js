'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const eventService = require('./event.service');
const betService = require('../bet/bet.service');

const create = asyncHandler(async (req, res) => {
  const event = await eventService.create(req.body);
  sendSuccess(res, { statusCode: 201, message: 'Event created', data: event });
});

const list = asyncHandler(async (req, res) => {
  const { items, ...meta } = await eventService.list(req.query);
  sendSuccess(res, { data: items, meta });
});

const getById = asyncHandler(async (req, res) => {
  const event = await eventService.getById(req.params.id);
  sendSuccess(res, { data: event });
});

const settle = asyncHandler(async (req, res) => {
  const event = await eventService.settle(req.params.id, req.body.result);
  const summary = await betService.settleForEvent(event._id, event.result);
  sendSuccess(res, { message: 'Event settled', data: { event, settlement: summary } });
});

module.exports = { create, list, getById, settle };
