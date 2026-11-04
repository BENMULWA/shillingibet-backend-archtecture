'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const service = require('./admin.service');
const transactionService = require('../transaction/transaction.service');
const payoutFloatService = require('./payoutFloat.service');
const managementService = require('./admin.management.service');
const { streamCsv } = require('../../utils/csv');
const cashbackService = require('../cashback/cashback.service');
const freeBetService = require('./admin.freebet.service');
const bonusFraudService = require('./admin.bonusFraud.service');
const auditService = require('./admin.audit.service');
const authEventService = require('./authEvent.service');
const notificationService = require('../notification/notification.service');

const overview = asyncHandler(async (req, res) => {
  const data = await service.getOverview(req.query);
  sendSuccess(res, { data });
});

const monthly = asyncHandler(async (req, res) => {
  const data = await service.getMonthlyAnalytics(req.query);
  sendSuccess(res, { data });
});

const activity = asyncHandler(async (req, res) => {
  const data = await service.getRecentActivity(req.query);
  sendSuccess(res, { data });
});

const transactions = asyncHandler(async (req, res) => {
  const { items, ...meta } = await transactionService.listForAdmin(req.query);
  sendSuccess(res, { data: items, meta });
});

const getPayoutFloat = asyncHandler(async (_req, res) => {
  const data = await payoutFloatService.getPayoutFloat();
  sendSuccess(res, { data });
});

const allocatePayoutFloat = asyncHandler(async (req, res) => {
  const data = await payoutFloatService.allocatePayoutFloat({
    ...req.body,
    actorId: req.user._id,
  });
  sendSuccess(res, { message: 'Payout float allocated', data });
});

const reconcileVirtualBet = asyncHandler(async (req, res) => {
  const data = await service.reconcileVirtualBet(req.body);
  sendSuccess(res, { message: 'Virtual bet reconciled', data });
});

const listUsers = asyncHandler(async (req, res) => {
  const { items, ...meta } = await managementService.listUsers(req.query);
  sendSuccess(res, { data: items, meta });
});

const listFraudAlerts = asyncHandler(async (req, res) => {
  const { items, ...meta } = await bonusFraudService.listAlerts(req.query);
  sendSuccess(res, { data: items, meta });
});

const fraudStats = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: await bonusFraudService.stats(req.query) });
});

const fraudUserProfile = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: await bonusFraudService.userProfile(req.params.userId) });
});

const resolveFraudAlert = asyncHandler(async (req, res) => {
  const data = await bonusFraudService.resolveAlert(
    req.params.alertId,
    req.body.status,
    req.user._id,
    req.body.resolutionNotes
  );
  sendSuccess(res, { message: 'Bonus alert resolved', data });
});

const listBets = asyncHandler(async (req, res) => {
  const { items, ...meta } = await managementService.listBets(req.query);
  sendSuccess(res, { data: items, meta });
});

const createStaff = asyncHandler(async (req, res) => {
  const user = await managementService.createStaff(req.body);
  res.locals.audit = {
    action: 'staff.create',
    targetUser: user._id,
    changes: { phone: user.phone, adminLevel: user.adminLevel },
  };
  sendSuccess(res, {
    statusCode: 201,
    message: 'Staff account created',
    data: user,
  });
});

const listStaff = asyncHandler(async (req, res) => {
  const { items, ...meta } = await managementService.listStaff(req.query);
  sendSuccess(res, { data: items, meta });
});

const manageStaff = asyncHandler(async (req, res) => {
  const { staff, changes } = await managementService.manageStaff(req.user, req.params.id, req.body);
  res.locals.audit = { action: 'staff.update', targetUser: staff._id, changes };
  sendSuccess(res, { message: 'Staff account updated', data: staff });
});

const sendStaffPasswordReset = asyncHandler(async (req, res) => {
  const data = await managementService.sendStaffPasswordReset(req.user, req.params.id);
  res.locals.audit = { action: 'staff.send_password_reset', targetUser: req.params.id };
  sendSuccess(res, { message: 'Password reset code sent by SMS', data });
});

const exportUsers = asyncHandler(async (req, res) => {
  await streamCsv(
    res,
    'users.csv',
    ['Phone', 'Name', 'Email', 'Status', 'Staff', 'Staff level', 'Balance', 'Referred by', 'Joined'],
    managementService.exportUsers(req.query)
  );
});

const exportTransactions = asyncHandler(async (req, res) => {
  await streamCsv(
    res,
    'transactions.csv',
    ['Reference', 'Phone', 'Type', 'Status', 'Amount', 'Tax', 'Net amount', 'Currency', 'Provider', 'Created', 'Completed'],
    managementService.exportTransactions(req.query)
  );
});

const exportBets = asyncHandler(async (req, res) => {
  await streamCsv(
    res,
    'bets.csv',
    ['Source', 'Bet ID', 'Phone', 'Game', 'Selection', 'Odds', 'Stake', 'Payout', 'Status', 'Placed', 'Settled'],
    managementService.exportBets(req.query)
  );
});

const updateUserControls = asyncHandler(async (req, res) => {
  const { user, changes } = await managementService.updateUserControls(req.user, req.params.id, req.body);
  res.locals.audit = { action: 'user.update_controls', targetUser: user._id, changes };
  sendSuccess(res, { message: 'User controls updated', data: user });
});

const zeroUserBalance = asyncHandler(async (req, res) => {
  const { user, adjustment } = await managementService.zeroUserBalance(req.user, req.params.id, req.body.reason);
  res.locals.audit = {
    action: 'user.zero_balance',
    targetUser: user._id,
    reason: req.body.reason,
    changes: {
      balance: { before: adjustment.balanceBefore, after: 0 },
      bonusBalance: { before: adjustment.bonusBalanceBefore, after: 0 },
    },
  };
  sendSuccess(res, { message: 'User total and bonus balances set to zero', data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  const changes = await managementService.deleteUser(req.user, req.params.id);
  res.locals.audit = { action: 'user.delete', targetUser: req.params.id, changes };
  sendSuccess(res, { message: 'User account deleted' });
});

const listCashbackAwards = asyncHandler(async (req, res) => {
  const { items, ...meta } = await cashbackService.listAwards(req.query);
  sendSuccess(res, { data: items, meta });
});

const createFreeBetCampaign = asyncHandler(async (req, res) => {
  const result = await freeBetService.createCampaign(req.user._id, req.body);
  sendSuccess(res, { statusCode: 201, message: 'Free-bet campaign created', data: result.data });
});

const listFreeBetCampaigns = asyncHandler(async (req, res) => {
  const result = await freeBetService.listCampaigns(req.query);
  sendSuccess(res, { data: result.data });
});

const getFreeBetCampaign = asyncHandler(async (req, res) => {
  const result = await freeBetService.getCampaign(req.params.campaignId);
  sendSuccess(res, { data: result.data });
});

const updateFreeBetCampaignStatus = asyncHandler(async (req, res) => {
  const result = await freeBetService.updateCampaignStatus(req.user._id, req.params.campaignId, req.body.status);
  sendSuccess(res, { message: 'Free-bet campaign status updated', data: result.data });
});

const awardFreeBets = asyncHandler(async (req, res) => {
  const result = await freeBetService.awardUsers(req.user._id, req.params.campaignId, req.body.userIds);
  sendSuccess(res, { message: 'Free bets awarded', data: result.data });
});

const listFreeBetAwards = asyncHandler(async (req, res) => {
  const result = await freeBetService.listAwards(req.query);
  sendSuccess(res, { data: result.data });
});

const revokeFreeBet = asyncHandler(async (req, res) => {
  const result = await freeBetService.revokeAward(req.user._id, req.params.freeBetId, req.body.reason);
  sendSuccess(res, { message: 'Free bet revoked', data: result.data });
});

const listFreeBetAudit = asyncHandler(async (req, res) => {
  const { items, ...meta } = await freeBetService.listAudit(req.query);
  sendSuccess(res, { data: items, meta });
});

const listFreeBetUsers = asyncHandler(async (req, res) => {
  const { items, ...meta } = await freeBetService.listUsers(req.query);
  sendSuccess(res, { data: items, meta });
});

const listAuditLogs = asyncHandler(async (req, res) => sendSuccess(res, { data: await auditService.list(req.query) }));
const listAuditLogsByDate = asyncHandler(async (req, res) => sendSuccess(res, { data: await auditService.byDate(req.params.date) }));
const listAuditDates = asyncHandler(async (_req, res) => sendSuccess(res, { data: await auditService.dates() }));
const getAuditStats = asyncHandler(async (_req, res) => sendSuccess(res, { data: await auditService.stats() }));
const listAuditLogsByUser = asyncHandler(async (req, res) => sendSuccess(res, { data: await auditService.byUser(req.params.userId, req.query) }));
const listAuthEvents = asyncHandler(async (req, res) => sendSuccess(res, { data: await authEventService.list(req.query) }));

const listNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const data = await notificationService.list({
    page: Number(page),
    limit: Number(limit),
    unreadOnly: unreadOnly === 'true',
  });
  sendSuccess(res, { data });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  await notificationService.markRead(req.params.id);
  sendSuccess(res, { message: 'Notification marked as read' });
});

const markAllNotificationsRead = asyncHandler(async (_req, res) => {
  await notificationService.markAllRead();
  sendSuccess(res, { message: 'All notifications marked as read' });
});

module.exports = {
  listUsers,
  listFraudAlerts,
  fraudStats,
  fraudUserProfile,
  resolveFraudAlert,
  listBets,
  createStaff,
  listStaff,
  manageStaff,
  sendStaffPasswordReset,
  exportUsers,
  exportTransactions,
  exportBets,
  updateUserControls,
  zeroUserBalance,
  deleteUser,
  listCashbackAwards,
  createFreeBetCampaign,
  listFreeBetCampaigns,
  getFreeBetCampaign,
  updateFreeBetCampaignStatus,
  awardFreeBets,
  listFreeBetAwards,
  revokeFreeBet,
  listFreeBetAudit,
  listFreeBetUsers,
  listAuditLogs,
  listAuditLogsByDate,
  listAuditDates,
  getAuditStats,
  listAuditLogsByUser,
  listAuthEvents,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  overview,
  monthly,
  activity,
  transactions,
  getPayoutFloat,
  allocatePayoutFloat,
  reconcileVirtualBet,
};
