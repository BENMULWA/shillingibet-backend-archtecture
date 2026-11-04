'use strict';

const { Router } = require('express');
const controller = require('./admin.controller');
const schemas = require('./admin.validation');
const validate = require('../../middlewares/validate');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');

const router = Router();

router.use(authenticate, authorizeStaff('support', 'admin', 'super_admin'));

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

module.exports = router;
