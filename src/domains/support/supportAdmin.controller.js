'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const service = require('./supportAdmin.service');

const listAgents = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await service.listAgents(req.query) }));
const listOnlineAgents = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await service.listOnlineAgents(req.user._id) }));
const setAgentBan = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    message: req.body.ban ? 'Agent suspended' : 'Agent activated',
    data: await service.setAgentBan(req.user, req.params.userId, req.body),
  }));
const listSessions = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await service.listSessions(req.query) }));
const getSession = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await service.getSession(req.params.sessionId) }));

module.exports = {
  getSession,
  listAgents,
  listOnlineAgents,
  listSessions,
  setAgentBan,
};
