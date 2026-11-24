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
const staffRoles = require('./staffRole.service');
const financeService = require('./finance.service');
const balanceIntegrity = require('./balanceIntegrity.service');

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
  const before = await payoutFloatService.getPayoutFloat();
  const data = await payoutFloatService.allocatePayoutFloat({
    ...req.body,
    actorId: req.user._id,
  });
  // Real Mamlaka payout balance right now (best effort, max 5 s), kept with the
  // allocation so it can be reconciled against the top-up on the statement.
  const live = await Promise.race([
    require('./providerBalance.service').readLiveBalances().catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  res.locals.audit = {
    action: 'payout_float_allocation',
    reason: req.body.note || null,
    changes: {
      amount: Number(req.body.amount),
      before: before.balance,
      after: data.balance,
      mamlakaPayoutKes: live?.payoutKes ?? null,
    },
  };
  sendSuccess(res, { message: 'Payout float allocated', data });
});

const listTreasuryMovements = asyncHandler(async (req, res) => {
  const [movements, live] = await Promise.all([
    require('./payoutFloatHistory.service').listMovements({ limit: req.query.limit }),
    Promise.race([
      require('./providerBalance.service').readLiveBalances().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]),
  ]);
  sendSuccess(res, { data: { movements, mamlakaPayoutKes: live?.payoutKes ?? null } });
});

const gatewayWatch = () => require('./gatewayWatch.service');

const gatewayWatchStatus = asyncHandler(async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 14);
  sendSuccess(res, { data: await gatewayWatch().getStatus({ hours }) });
});

const gatewayWatchCheck = asyncHandler(async (req, res) => {
  const result = await gatewayWatch().tick({ force: true });
  res.locals.audit = { action: 'gateway_watch.check_now', changes: { alerted: Boolean(result.alerted), skipped: Boolean(result.skipped) } };
  sendSuccess(res, { data: { checked: Boolean(result.checked), alerted: Boolean(result.alerted), confirming: Boolean(result.confirming), skipped: Boolean(result.skipped), error: result.error || null } });
});

const gatewayWatchAcknowledge = asyncHandler(async (req, res) => {
  const data = await gatewayWatch().acknowledge({ actorId: req.user._id, reason: req.body.reason, resumeWithdrawals: req.body.resumeWithdrawals });
  res.locals.audit = { action: 'gateway_watch.acknowledged', reason: req.body.reason, changes: data };
  sendSuccess(res, { data });
});

const gatewayWatchHold = asyncHandler(async (req, res) => {
  const hold = await gatewayWatch().setHold({ active: req.body.active, reason: req.body.reason, by: req.user._id });
  res.locals.audit = { action: req.body.active ? 'gateway_watch.withdrawals_paused' : 'gateway_watch.withdrawals_resumed', reason: req.body.reason, changes: { hold } };
  sendSuccess(res, { data: { hold } });
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
  const { user, existingPlayer } = await managementService.createStaff(req.body);
  res.locals.audit = {
    action: existingPlayer ? 'staff.add_to_player_account' : 'staff.create',
    targetUser: user._id,
    changes: { phone: user.phone, adminLevel: user.adminLevel, existingPlayer },
  };
  sendSuccess(res, {
    statusCode: 201,
    message: existingPlayer
      ? 'Staff access added to this player account. They keep their current password; use Send reset SMS if they need a new one.'
      : 'Staff account created',
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

const balanceIntegrityReport = asyncHandler(async (_req, res) => {
  sendSuccess(res, { data: await balanceIntegrity.scanAll() });
});

const playerBalanceIntegrity = asyncHandler(async (req, res) => {
  const data = await balanceIntegrity.checkUser(req.params.id);
  if (!data) return res.status(404).json({ success: false, message: 'Player not found' });
  return sendSuccess(res, { data });
});

const approvePlayerBalance = asyncHandler(async (req, res) => {
  const result = await balanceIntegrity.approveBalance({ actor: req.user, userId: req.params.id, reason: req.body.reason });
  res.locals.audit = {
    action: 'player.balance_approved',
    targetUser: req.params.id,
    reason: req.body.reason,
    changes: {
      approvedAmount: result.before.excess,
      balance: result.before.actual,
      expectedBefore: result.before.expected,
      parts: result.before.parts,
      selfApproval: String(req.user._id) === String(req.params.id),
    },
  };
  sendSuccess(res, { message: 'Balance approved and withdrawals re-enabled', data: result.after });
});

// Phone numbers of players who can receive a bulk SMS (Bulk SMS "Load all players").
// Served under /exports so the audit log records it as a personal-data export.
const reconcileWithdrawal = asyncHandler(async (req, res) => {
  const data = await transactionService.reconcileWithdrawalByAdmin(req.params.transactionId);
  res.locals.audit = { action: 'withdrawal.recheck_provider', changes: { transactionId: req.params.transactionId, providerStatus: data.providerStatus, changed: data.changed } };
  sendSuccess(res, {
    message: data.changed ? `Withdrawal marked ${data.providerStatus}` : data.message,
    data,
  });
});

const resolveWithdrawal = asyncHandler(async (req, res) => {
  const data = await transactionService.manuallyResolveWithdrawal(req.params.transactionId, req.user, req.body);
  res.locals.audit = {
    action: `withdrawal.manual_${req.body.status}`,
    targetUser: data.user,
    reason: req.body.reason,
    changes: { transactionId: req.params.transactionId, externalId: data.externalId, amount: data.amount, status: req.body.status, providerReference: req.body.providerReference },
  };
  sendSuccess(res, {
    message: req.body.status === 'failed' ? 'Withdrawal marked failed and refunded' : 'Withdrawal marked completed',
    data,
  });
});

const smsRecipients = asyncHandler(async (req, res) => {
  const User = require('../user/user.model');
  const includeUnverified = req.query.includeUnverified === 'true';
  const filter = {
    deletedAt: null,
    status: 'active',
    isStaff: { $ne: true },
    phone: /^254[17]\d{8}$/,
    ...(includeUnverified ? {} : { phoneVerified: true }),
  };
  const phones = (await User.distinct('phone', filter)).sort();
  sendSuccess(res, { data: { phones, count: phones.length, includeUnverified } });
});

const financeReport = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: await financeService.getFinanceReport(req.query) });
});

const exportFinanceReport = asyncHandler(async (req, res) => {
  const report = await financeService.getFinanceReport(req.query);
  const from = report.days[0]?.date || 'report';
  const to = report.days[report.days.length - 1]?.date || '';
  await streamCsv(res, `finance-${from}${to && to !== from ? `-to-${to}` : ''}.csv`, financeService.CSV_HEADERS, financeService.financeCsvRows(report));
});

const listRoles = asyncHandler(async (_req, res) => {
  sendSuccess(res, { data: await staffRoles.listRoles() });
});

const createRole = asyncHandler(async (req, res) => {
  const role = await staffRoles.createRole(req.body);
  res.locals.audit = { action: 'staff_role.create', changes: role };
  sendSuccess(res, { statusCode: 201, message: 'Role created', data: role });
});

const updateRole = asyncHandler(async (req, res) => {
  const { role, changes } = await staffRoles.updateRole(req.params.key, req.body);
  res.locals.audit = { action: 'staff_role.update', changes: { key: role.key, ...changes } };
  sendSuccess(res, { message: 'Role updated', data: role });
});

const deleteRole = asyncHandler(async (req, res) => {
  const data = await staffRoles.deleteRole(req.params.key);
  res.locals.audit = { action: 'staff_role.delete', changes: data };
  sendSuccess(res, { message: 'Role deleted', data });
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
    ['Reference', 'External ID', 'Provider receipt', 'Provider secure ID', 'Phone', 'Type', 'Status', 'Wallet', 'Amount (wallet)', 'Tax', 'Fee', 'Amount moved by provider', 'Currency', 'Provider', 'Created', 'Completed'],
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
  listRoles,
  financeReport,
  smsRecipients,
  reconcileWithdrawal,
  resolveWithdrawal,
  balanceIntegrityReport,
  playerBalanceIntegrity,
  approvePlayerBalance,
  exportFinanceReport,
  createRole,
  updateRole,
  deleteRole,
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
  listTreasuryMovements,
  gatewayWatchStatus,
  gatewayWatchCheck,
  gatewayWatchAcknowledge,
  gatewayWatchHold,
  reconcileVirtualBet,
};
