'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const service = require('./announcement.service');

const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: await service.list(req.query) });
});

const create = asyncHandler(async (req, res) => {
  const data = await service.create(req.user, req.body);
  res.locals.audit = { action: 'announcement.create', reason: data.title || data.message.slice(0, 80) };
  sendSuccess(res, { statusCode: 201, message: 'Announcement sent to players', data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.params.id);
  res.locals.audit = { action: 'announcement.delete', reason: data.title || data.message.slice(0, 80) };
  sendSuccess(res, { message: 'Announcement removed', data });
});

module.exports = { list, create, remove };
