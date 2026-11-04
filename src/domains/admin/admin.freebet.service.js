'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiError = require('../../utils/ApiError');
const config = require('../../config');
const logger = require('../../utils/logger');
const eurovirtuals = require('../../integrations/eurovirtuals/eurovirtuals.client');
const User = require('../user/user.model');
const FreeBetAudit = require('./freeBetAudit.model');

const providerResult = (response) => {
  const body = response?.body || {};
  const businessCode = Number(body.status_code);
  const businessSucceeded = Number.isFinite(businessCode)
    ? businessCode >= 200 && businessCode < 300
    : response?.status >= 200 && response?.status < 300;

  if (response?.status >= 200 && response?.status < 300 && businessSucceeded) {
    return body;
  }

  const providerStatus = Number.isFinite(businessCode) ? businessCode : response?.status;
  const safeStatus = [400, 401, 403, 404, 409, 422, 500, 502].includes(providerStatus)
    ? providerStatus
    : 502;
  throw new ApiError(
    safeStatus,
    body.status_description || 'EuroVirtuals free-bet request failed',
    { providerStatus: providerStatus || null }
  );
};

const writeAudit = async (record) => {
  try {
    await FreeBetAudit.create(record);
  } catch (error) {
    logger.error('Unable to persist free-bet audit record', record.action, record.requestId, error.message);
  }
};

const executeAudited = async ({ actorId, action, requestId, campaignId, freeBetId, userIds, request }, operation) => {
  try {
    const response = await operation();
    const result = providerResult(response);
    const resolvedCampaignId = campaignId || result.data?.campaign_id || null;
    const resolvedFreeBetId = freeBetId || result.data?.freebet_id || null;
    await writeAudit({
      actor: actorId,
      action,
      outcome: 'success',
      requestId,
      campaignId: resolvedCampaignId,
      freeBetId: resolvedFreeBetId,
      userIds: userIds || [],
      request,
      providerStatus: Number(result.status_code) || null,
      providerDescription: result.status_description || null,
      result: result.data || null,
    });
    return result;
  } catch (error) {
    await writeAudit({
      actor: actorId,
      action,
      outcome: 'failed',
      requestId,
      campaignId: campaignId || null,
      freeBetId: freeBetId || null,
      userIds: userIds || [],
      request,
      providerStatus: error.details?.providerStatus || error.statusCode || null,
      providerDescription: error.message,
    });
    throw error;
  }
};

const createCampaign = async (actorId, input) => {
  const requestId = crypto.randomUUID();
  const body = {
    request_id: requestId,
    game_uuid: input.gameUuid,
    name: input.name,
    description: input.description,
    currency: input.currency || config.eurovirtuals.currency,
    amount: input.amount,
    count_per_player: input.countPerPlayer,
    minimum_multiplier: input.minimumMultiplier,
    deduct_stake_on_win: input.deductStakeOnWin,
    start_date: input.startDate.toISOString(),
    end_date: input.endDate.toISOString(),
    validity: input.validity,
  };
  return executeAudited({
    actorId,
    action: 'campaign_create',
    requestId,
    request: body,
  }, () => eurovirtuals.createFreeBetCampaign(body));
};

const listCampaigns = async (query) => providerResult(
  await eurovirtuals.listFreeBetCampaigns(query)
);

const getCampaign = async (campaignId) => providerResult(
  await eurovirtuals.getFreeBetCampaign(campaignId)
);

const updateCampaignStatus = async (actorId, campaignId, status) => {
  const requestId = crypto.randomUUID();
  const body = { request_id: requestId, status };
  return executeAudited({
    actorId,
    action: 'campaign_status',
    requestId,
    campaignId,
    request: body,
  }, () => eurovirtuals.updateFreeBetCampaignStatus(campaignId, body));
};

const getActiveCampaignPlayerIds = async (campaignId) => {
  const playerIds = new Set();
  let page = 1;
  let total = 0;
  let fetched = 0;
  do {
    const result = providerResult(await eurovirtuals.listFreeBetAwards({
      campaignId,
      status: 1,
      page,
      perPage: 100,
    }));
    const data = result.data || {};
    const awards = data.freebets || [];
    awards.forEach((award) => playerIds.add(String(award.player_id)));
    fetched += awards.length;
    total = Number(data.total) || awards.length;
    page += 1;
    if (!awards.length && fetched < total) {
      throw new ApiError(502, 'EuroVirtuals returned an incomplete active-awards list');
    }
    if (page > 101 && fetched < total) {
      throw new ApiError(502, 'Campaign has too many active awards to verify safely');
    }
  } while (fetched < total);
  return playerIds;
};

const awardUsers = async (actorId, campaignId, userIds) => {
  const requestId = crypto.randomUUID();
  return executeAudited({
    actorId,
    action: 'award_create',
    requestId,
    campaignId,
    userIds,
    request: { playerIds: userIds },
  }, async () => {
    const users = await User.find({
      _id: { $in: userIds },
      role: 'user',
      isStaff: { $ne: true },
      status: 'active',
      deletedAt: null,
    }).select('_id name phone').lean();

    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const missing = userIds.filter((id) => !usersById.has(id));
    if (missing.length) {
      throw ApiError.badRequest('Some selected users are missing or ineligible', { userIds: missing });
    }

    const activePlayerIds = await getActiveCampaignPlayerIds(campaignId);
    const duplicates = userIds.filter((id) => activePlayerIds.has(id));
    if (duplicates.length) {
      throw ApiError.conflict('Some selected users already have an active unused free bet');
    }

    const players = userIds.map((id) => {
      const user = usersById.get(id);
      return {
        player_id: String(user._id),
        player_name: user.name || user.phone,
      };
    });
    return eurovirtuals.awardFreeBets(campaignId, { request_id: requestId, players });
  });
};

const listAwards = async (query) => {
  const result = providerResult(await eurovirtuals.listFreeBetAwards(query));
  const awards = result.data?.freebets || [];
  const playerIds = [...new Set(
    awards
      .map((award) => String(award.player_id || ''))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  )];
  const users = playerIds.length
    ? await User.find({ _id: { $in: playerIds } }).select('_id name phone email').lean()
    : [];
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  return {
    ...result,
    data: {
      ...(result.data || {}),
      freebets: awards.map((award) => ({
        ...award,
        player: usersById.get(String(award.player_id)) || null,
      })),
    },
  };
};

const revokeAward = async (actorId, freeBetId, reason) => {
  const requestId = crypto.randomUUID();
  const body = { request_id: requestId, reason };
  return executeAudited({
    actorId,
    action: 'award_revoke',
    requestId,
    freeBetId,
    request: body,
  }, () => eurovirtuals.revokeFreeBet(freeBetId, body));
};

const listAudit = async ({ action, outcome, campaignId, page, limit }) => {
  const filter = {};
  if (action) filter.action = action;
  if (outcome) filter.outcome = outcome;
  if (campaignId) filter.campaignId = campaignId;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    FreeBetAudit.find(filter)
      .populate('actor', 'name phone adminLevel')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FreeBetAudit.countDocuments(filter),
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const listUsers = async ({ page, limit, search, status }) => {
  const filter = {
    deletedAt: null,
    role: 'user',
    isStaff: { $ne: true },
  };
  if (status) filter.status = status;
  if (search) {
    const expression = { $regex: escapeRegex(search), $options: 'i' };
    const options = [{ phone: expression }, { name: expression }, { email: expression }];
    if (mongoose.Types.ObjectId.isValid(search)) options.push({ _id: search });
    filter.$or = options;
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .select('_id name phone email status balance createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

module.exports = {
  providerResult,
  executeAudited,
  createCampaign,
  listCampaigns,
  getCampaign,
  updateCampaignStatus,
  awardUsers,
  listAwards,
  revokeAward,
  listAudit,
  listUsers,
  getActiveCampaignPlayerIds,
};
