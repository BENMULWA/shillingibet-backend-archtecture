'use strict';

const ApiError = require('../../utils/ApiError');
const { withTransaction } = require('../../utils/db');
const User = require('../user/user.model');
const ReferralAward = require('../user/referralAward.model');
const WelcomeBonusAward = require('../user/welcomeBonusAward.model');

const publicStatus = (status) =>
  status === 'held' ? 'open' : status === 'credited' ? 'resolved_legitimate' : 'resolved_fraud';

const riskLevel = (score) =>
  score >= 100 ? 'critical' : score >= 70 ? 'high' : score >= 30 ? 'medium' : 'low';

const normalizeAward = (kind, award) => {
  const target = kind === 'referral' ? award.referredUser : award.user;
  return {
    _id: `${kind}:${award._id}`,
    awardId: String(award._id),
    type: `${kind}_bonus`,
    phone: target?.phone || null,
    user: target ? { _id: target._id, phone: target.phone, name: target.name || null } : null,
    referrer: kind === 'referral' && award.referrer
      ? { _id: award.referrer._id, phone: award.referrer.phone, name: award.referrer.name || null }
      : null,
    riskScore: Number(award.riskScore || (award.status === 'held' ? 100 : 0)),
    riskLevel: riskLevel(Number(award.riskScore || (award.status === 'held' ? 100 : 0))),
    status: publicStatus(award.status),
    action: award.status === 'held' ? 'bonus_held' : `bonus_${award.status}`,
    reasons: award.reasons || [],
    context: { provider: kind, betAmount: award.amount, reasons: award.reasons || [] },
    createdAt: award.createdAt,
    reviewedAt: award.reviewedAt || null,
    reviewNotes: award.reviewNotes || null,
  };
};

const loadAwards = async (createdAt) => {
  const filter = {
    $and: [
      { $or: [{ status: { $ne: 'credited' } }, { 'reasons.0': { $exists: true } }] },
      ...(createdAt ? [{ createdAt: { $gte: createdAt } }] : []),
    ],
  };
  const [referrals, welcomes] = await Promise.all([
    ReferralAward.find(filter).populate('referredUser referrer', 'phone name').lean(),
    WelcomeBonusAward.find(filter).populate('user', 'phone name').lean(),
  ]);
  return [
    ...referrals.map((award) => normalizeAward('referral', award)),
    ...welcomes.map((award) => normalizeAward('welcome', award)),
  ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
};

const userProfile = async (userId) => {
  const user = await User.findById(userId).select('phone name').lean();
  if (!user) throw ApiError.notFound('User not found');
  const alerts = (await loadAwards()).filter((alert) => String(alert.user?._id) === String(userId));
  const totalRiskScore = alerts.reduce((sum, alert) => sum + alert.riskScore, 0);
  const averageRiskScore = alerts.length ? totalRiskScore / alerts.length : 0;
  return {
    _id: user._id,
    phone: user.phone,
    name: user.name || null,
    registrationIp: 'Protected',
    riskProfile: {
      openAlerts: alerts.filter((alert) => alert.status === 'open').length,
      totalRiskScore,
      averageRiskScore,
      riskLevel: riskLevel(averageRiskScore),
      alertTypes: alerts.reduce((out, alert) => ({ ...out, [alert.type]: (out[alert.type] || 0) + 1 }), {}),
    },
    recentAlerts: alerts.slice(0, 10),
  };
};

const listAlerts = async ({ page, limit }) => {
  const alerts = await loadAwards();
  const start = (page - 1) * limit;
  return { items: alerts.slice(start, start + limit), total: alerts.length, page, limit, pages: Math.ceil(alerts.length / limit) };
};

const stats = async ({ days }) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const alerts = await loadAwards(since);
  const countBy = (field) => alerts.reduce((out, alert) => ({ ...out, [alert[field]]: (out[alert[field]] || 0) + 1 }), {});
  const daily = alerts.reduce((out, alert) => {
    const day = new Date(alert.createdAt).toISOString().slice(0, 10);
    const current = out.get(day) || { _id: day, count: 0, scoreTotal: 0 };
    current.count += 1;
    current.scoreTotal += alert.riskScore;
    out.set(day, current);
    return out;
  }, new Map());
  return {
    total: alerts.length,
    uniqueUsers: new Set(alerts.map((alert) => String(alert.user?._id || ''))).size,
    byStatus: countBy('status'),
    byType: countBy('type'),
    byRiskLevel: countBy('riskLevel'),
    byDay: [...daily.values()]
      .map((row) => ({ _id: row._id, count: row.count, avgScore: row.scoreTotal / row.count }))
      .sort((left, right) => right._id.localeCompare(left._id)),
  };
};

const resolveInSession = async (kind, awardId, resolution, actorId, notes, session) => {
  const Model = kind === 'referral' ? ReferralAward : kind === 'welcome' ? WelcomeBonusAward : null;
  if (!Model) throw ApiError.badRequest('Invalid bonus alert ID');
  const reviewedAt = new Date();
  const nextStatus = resolution === 'resolved_legitimate' ? 'credited' : 'rejected';
  const award = await Model.findOneAndUpdate(
    { _id: awardId, status: 'held' },
    { $set: { status: nextStatus, reviewedAt, reviewedBy: actorId, reviewNotes: notes || null, ...(nextStatus === 'credited' ? { creditedAt: reviewedAt } : {}) } },
    { new: true, ...(session ? { session } : {}) }
  );
  if (!award) throw ApiError.conflict('Bonus alert has already been resolved or does not exist');

  if (kind === 'referral') {
    await User.updateOne(
      { _id: award.referredUser },
      { $set: { 'referralReward.reviewStatus': nextStatus, ...(nextStatus === 'credited' ? { 'referralReward.bonusGrantedAt': reviewedAt, 'referralReward.bonusAmount': award.amount } : {}) } },
      session ? { session } : undefined
    );
    if (nextStatus === 'credited') {
      const creditedReferrer = await User.updateOne(
        { _id: award.referrer, status: 'active', deletedAt: null },
        { $inc: { balance: award.amount, bonusBalance: award.amount, 'referralStats.bonusEarned': award.amount } },
        session ? { session } : undefined
      );
      if (creditedReferrer.matchedCount !== 1) throw ApiError.conflict('Referrer is no longer eligible');
    }
  } else {
    await User.updateOne(
      { _id: award.user },
      {
        $set: { 'welcomeBonus.reviewStatus': nextStatus, ...(nextStatus === 'credited' ? { 'welcomeBonus.grantedAt': reviewedAt, 'welcomeBonus.amount': award.amount } : {}) },
        ...(nextStatus === 'credited' ? { $inc: { balance: award.amount, bonusBalance: award.amount } } : {}),
      },
      session ? { session } : undefined
    );
  }
  await award.populate(kind === 'referral' ? 'referredUser referrer' : 'user', 'phone name');
  return normalizeAward(kind, award);
};

const resolveAlert = (alertId, resolution, actorId, notes) => {
  const [kind, awardId] = String(alertId).split(':');
  return withTransaction(
    (session) => resolveInSession(kind, awardId, resolution, actorId, notes, session),
    () => resolveInSession(kind, awardId, resolution, actorId, notes)
  );
};

module.exports = { listAlerts, stats, resolveAlert, userProfile };
