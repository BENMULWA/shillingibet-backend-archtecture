'use strict';

const { Router } = require('express');
const controller = require('./admin.controller');
const schemas = require('./admin.validation');
const mgmt = require('./admin.management.validation');
const adminAudit = require('../../middlewares/adminAudit');
const validate = require('../../middlewares/validate');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');

const router = Router();

router.use(authenticate, authorizeStaff('support', 'admin', 'super_admin'));
router.use(adminAudit);

router.get('/analytics/overview', validate({ query: schemas.overview }), controller.overview);
router.get('/analytics/monthly', validate({ query: schemas.monthly }), controller.monthly);
router.get('/analytics/activity', validate({ query: schemas.activity }), controller.activity);
router.get('/transactions', validate({ query: schemas.transactions }), controller.transactions);
router.get('/treasury/withdrawals', controller.getPayoutFloat);
router.post(
  '/treasury/withdrawals/allocations',
  authorizeStaff('super_admin'),
  validate({ body: schemas.payoutFloatAllocation }),
  controller.allocatePayoutFloat
);
router.post(
  '/virtuals/reconcile-bet',
  authorizeStaff('admin', 'super_admin'),
  validate({ body: schemas.reconcileVirtualBet }),
  controller.reconcileVirtualBet
);

const admin = authorizeStaff('admin', 'super_admin');
const superAdmin = authorizeStaff('super_admin');

// Audit trail
router.get('/audit/logs', admin, validate({ query: mgmt.auditList }), controller.listAuditLogs);
router.get('/audit/logs/date/:date', admin, validate({ params: mgmt.auditDateParams }), controller.listAuditLogsByDate);
router.get('/audit/dates', admin, controller.listAuditDates);
router.get('/audit/stats', admin, controller.getAuditStats);
router.get('/audit/auth-events', admin, validate({ query: mgmt.authEventList }), controller.listAuthEvents);
router.get('/audit/user/:userId', admin, validate({ params: mgmt.auditUserParams, query: mgmt.auditList }), controller.listAuditLogsByUser);

// Notifications
router.get('/notifications', controller.listNotifications);
router.post('/notifications/read-all', controller.markAllNotificationsRead);
router.post('/notifications/:id/read', controller.markNotificationRead);

// Players and bets
router.get('/users', validate({ query: mgmt.listUsers }), controller.listUsers);
router.patch('/users/:id/controls', admin, validate({ body: mgmt.userControls }), controller.updateUserControls);
router.post('/users/:id/zero-balance', admin, validate({ body: mgmt.zeroBalance }), controller.zeroUserBalance);
router.delete('/users/:id', admin, controller.deleteUser);
router.get('/bets', validate({ query: mgmt.listBets }), controller.listBets);

// Fraud and bonuses
router.get('/fraud/alerts', admin, validate({ query: mgmt.fraudAlerts }), controller.listFraudAlerts);
router.get('/fraud/stats', admin, validate({ query: mgmt.fraudStats }), controller.fraudStats);
router.get('/fraud/user/:userId', admin, validate({ params: mgmt.fraudUserParams }), controller.fraudUserProfile);
router.patch('/fraud/alerts/:alertId/resolve', admin, validate({ params: mgmt.fraudAlertParams, body: mgmt.resolveFraudAlert }), controller.resolveFraudAlert);
router.get('/cashback/awards', admin, validate({ query: mgmt.cashbackAwards }), controller.listCashbackAwards);

// Staff
router.post('/staff', superAdmin, validate({ body: mgmt.createStaff }), controller.createStaff);
router.get('/staff', superAdmin, validate({ query: mgmt.listStaff }), controller.listStaff);
router.patch('/staff/:id', superAdmin, validate({ params: mgmt.staffParams, body: mgmt.manageStaff }), controller.manageStaff);
router.post('/staff/:id/send-password-reset', superAdmin, validate({ params: mgmt.staffParams }), controller.sendStaffPasswordReset);

// CSV exports
router.get('/exports/users', admin, validate({ query: mgmt.exportRange }), controller.exportUsers);
router.get('/exports/transactions', admin, validate({ query: mgmt.exportRange }), controller.exportTransactions);
router.get('/exports/bets', admin, validate({ query: mgmt.exportRange }), controller.exportBets);

// Free bets (campaigns live at the game provider)
router.post('/freebet/campaigns', superAdmin, validate({ body: mgmt.createFreeBetCampaign }), controller.createFreeBetCampaign);
router.get('/freebet/campaigns', superAdmin, validate({ query: mgmt.listFreeBetCampaigns }), controller.listFreeBetCampaigns);
router.get('/freebet/campaigns/:campaignId', superAdmin, validate({ params: mgmt.freeBetCampaignParams }), controller.getFreeBetCampaign);
router.patch('/freebet/campaigns/:campaignId/status', superAdmin, validate({ params: mgmt.freeBetCampaignParams, body: mgmt.updateFreeBetCampaignStatus }), controller.updateFreeBetCampaignStatus);
router.post('/freebet/campaigns/:campaignId/awards', superAdmin, validate({ params: mgmt.freeBetCampaignParams, body: mgmt.awardFreeBets }), controller.awardFreeBets);
router.get('/freebet/awards', superAdmin, validate({ query: mgmt.listFreeBetAwards }), controller.listFreeBetAwards);
router.post('/freebet/awards/:freeBetId/revoke', superAdmin, validate({ params: mgmt.freeBetAwardParams, body: mgmt.revokeFreeBet }), controller.revokeFreeBet);
router.get('/freebet/audit', superAdmin, validate({ query: mgmt.listFreeBetAudit }), controller.listFreeBetAudit);
router.get('/freebet/users', superAdmin, validate({ query: mgmt.listFreeBetUsers }), controller.listFreeBetUsers);

module.exports = router;
