'use strict';

const { Router } = require('express');
const controller = require('./admin.controller');
const schemas = require('./admin.validation');
const mgmt = require('./admin.management.validation');
const adminAudit = require('../../middlewares/adminAudit');
const validate = require('../../middlewares/validate');
const { authenticate, authorizeStaff, requirePermission, requireSuperAdmin } = require('../../middlewares/auth');
const announcementController = require('../announcement/announcement.controller');
const announcementSchemas = require('../announcement/announcement.validation');

const router = Router();

// Any staff role may reach the admin API; each route then checks a permission
// from the role editor (see permissions.js). Staff and roles stay super-admin only.
router.use(authenticate, authorizeStaff());
router.use(adminAudit);

const can = requirePermission;

// Overview
router.get('/analytics/overview', can('dashboard.view'), validate({ query: schemas.overview }), controller.overview);
router.get('/analytics/monthly', can('dashboard.view'), validate({ query: schemas.monthly }), controller.monthly);
router.get('/analytics/activity', can('dashboard.view'), validate({ query: schemas.activity }), controller.activity);

// Money
router.get('/transactions', can('transactions.view'), validate({ query: schemas.transactions }), controller.transactions);
// Stuck withdrawals: ask Mamlaka, or resolve after confirming with the provider.
router.post('/transactions/:transactionId/reconcile', can('transactions.reconcile'), validate({ params: mgmt.transactionParams }), controller.reconcileWithdrawal);
router.post('/transactions/:transactionId/resolve', can('transactions.resolve'), validate({ params: mgmt.transactionParams, body: mgmt.manualWithdrawalResolution }), controller.resolveWithdrawal);
router.get('/treasury/withdrawals', can('treasury.view'), controller.getPayoutFloat);
router.get('/treasury/withdrawals/movements', can('treasury.view'), controller.listTreasuryMovements);

// Finance report: revenue, withdrawal tax (owed to KRA) and fees, per Nairobi day.
// Polled under /analytics so the audit log isn't flooded; the CSV export is audited.
router.get('/analytics/finance', can('finance.view', 'treasury.view'), validate({ query: schemas.financeReport }), controller.financeReport);
router.get('/exports/finance', can('finance.view', 'treasury.view'), validate({ query: schemas.financeReport }), controller.exportFinanceReport);
router.post(
  '/treasury/withdrawals/allocations',
  can('treasury.allocate'),
  validate({ body: schemas.payoutFloatAllocation }),
  controller.allocatePayoutFloat
);
router.post(
  '/virtuals/reconcile-bet',
  can('bets.reconcile'),
  validate({ body: schemas.reconcileVirtualBet }),
  controller.reconcileVirtualBet
);

// Announcements to all players (shown in the site's Announcements tab)
router.get('/announcements', can('announcements.manage'), validate({ query: announcementSchemas.list }), announcementController.list);
router.post('/announcements', can('announcements.manage'), validate({ body: announcementSchemas.create }), announcementController.create);
router.delete('/announcements/:id', can('announcements.manage'), validate({ params: announcementSchemas.params }), announcementController.remove);

// Audit trail
router.get('/audit/logs', can('audit.view'), validate({ query: mgmt.auditList }), controller.listAuditLogs);
router.get('/audit/logs/date/:date', can('audit.view'), validate({ params: mgmt.auditDateParams }), controller.listAuditLogsByDate);
router.get('/audit/dates', can('audit.view'), controller.listAuditDates);
router.get('/audit/stats', can('audit.view'), controller.getAuditStats);
router.get('/audit/auth-events', can('audit.view'), validate({ query: mgmt.authEventList }), controller.listAuthEvents);
router.get('/audit/user/:userId', can('audit.view'), validate({ params: mgmt.auditUserParams, query: mgmt.auditList }), controller.listAuditLogsByUser);

// Notifications (every staff member has their own)
router.get('/notifications', controller.listNotifications);
router.post('/notifications/read-all', controller.markAllNotificationsRead);
router.post('/notifications/:id/read', controller.markNotificationRead);

// Players and bets
router.get('/users', can('players.view'), validate({ query: mgmt.listUsers }), controller.listUsers);
router.patch('/users/:id/controls', can('players.edit'), validate({ body: mgmt.userControls }), controller.updateUserControls);
router.post('/users/:id/zero-balance', can('players.edit'), validate({ body: mgmt.zeroBalance }), controller.zeroUserBalance);
router.delete('/users/:id', can('players.delete'), controller.deleteUser);
// Balance check for one player, and the super-admin approval that clears a flag.
router.get('/users/:id/balance-integrity', can('players.view', 'fraud.view'), validate({ params: mgmt.staffParams }), controller.playerBalanceIntegrity);
router.post('/users/:id/balance-review', requireSuperAdmin, validate({ params: mgmt.staffParams, body: mgmt.balanceReview }), controller.approvePlayerBalance);
router.get('/bets', can('bets.view'), validate({ query: mgmt.listBets }), controller.listBets);

// Fraud and bonuses
router.get('/fraud/alerts', can('fraud.view'), validate({ query: mgmt.fraudAlerts }), controller.listFraudAlerts);
router.get('/fraud/stats', can('fraud.view'), validate({ query: mgmt.fraudStats }), controller.fraudStats);
router.get('/fraud/user/:userId', can('fraud.view'), validate({ params: mgmt.fraudUserParams }), controller.fraudUserProfile);
router.patch('/fraud/alerts/:alertId/resolve', can('fraud.resolve'), validate({ params: mgmt.fraudAlertParams, body: mgmt.resolveFraudAlert }), controller.resolveFraudAlert);
// Wallets whose balance is not explained by deposits, play and recorded credits.
router.get('/fraud/balance-integrity', can('fraud.view'), controller.balanceIntegrityReport);
router.get('/cashback/awards', can('cashback.view'), validate({ query: mgmt.cashbackAwards }), controller.listCashbackAwards);

// Staff
router.post('/staff', requireSuperAdmin, validate({ body: mgmt.createStaff }), controller.createStaff);
router.get('/staff', requireSuperAdmin, validate({ query: mgmt.listStaff }), controller.listStaff);
router.patch('/staff/:id', requireSuperAdmin, validate({ params: mgmt.staffParams, body: mgmt.manageStaff }), controller.manageStaff);
router.post('/staff/:id/send-password-reset', requireSuperAdmin, validate({ params: mgmt.staffParams }), controller.sendStaffPasswordReset);

// Roles & permissions
router.get('/roles', requireSuperAdmin, controller.listRoles);
router.post('/roles', requireSuperAdmin, validate({ body: mgmt.createRole }), controller.createRole);
router.patch('/roles/:key', requireSuperAdmin, validate({ params: mgmt.roleParams, body: mgmt.updateRole }), controller.updateRole);
router.delete('/roles/:key', requireSuperAdmin, validate({ params: mgmt.roleParams }), controller.deleteRole);

// CSV exports
router.get('/exports/users', can('players.export'), validate({ query: mgmt.exportRange }), controller.exportUsers);
router.get('/exports/transactions', can('transactions.export'), validate({ query: mgmt.exportRange }), controller.exportTransactions);
router.get('/exports/sms-recipients', can('sms.send'), controller.smsRecipients);
router.get('/exports/bets', can('bets.export'), validate({ query: mgmt.exportRange }), controller.exportBets);

// Free bets (campaigns live at the game provider)
router.post('/freebet/campaigns', can('freebets.manage'), validate({ body: mgmt.createFreeBetCampaign }), controller.createFreeBetCampaign);
router.get('/freebet/campaigns', can('freebets.view'), validate({ query: mgmt.listFreeBetCampaigns }), controller.listFreeBetCampaigns);
router.get('/freebet/campaigns/:campaignId', can('freebets.view'), validate({ params: mgmt.freeBetCampaignParams }), controller.getFreeBetCampaign);
router.patch('/freebet/campaigns/:campaignId/status', can('freebets.manage'), validate({ params: mgmt.freeBetCampaignParams, body: mgmt.updateFreeBetCampaignStatus }), controller.updateFreeBetCampaignStatus);
router.post('/freebet/campaigns/:campaignId/awards', can('freebets.manage'), validate({ params: mgmt.freeBetCampaignParams, body: mgmt.awardFreeBets }), controller.awardFreeBets);
router.get('/freebet/awards', can('freebets.view'), validate({ query: mgmt.listFreeBetAwards }), controller.listFreeBetAwards);
router.post('/freebet/awards/:freeBetId/revoke', can('freebets.manage'), validate({ params: mgmt.freeBetAwardParams, body: mgmt.revokeFreeBet }), controller.revokeFreeBet);
router.get('/freebet/audit', can('freebets.view'), validate({ query: mgmt.listFreeBetAudit }), controller.listFreeBetAudit);
router.get('/freebet/users', can('freebets.view'), validate({ query: mgmt.listFreeBetUsers }), controller.listFreeBetUsers);

module.exports = router;
