'use strict';

const { Router } = require('express');
const controller = require('./admin.controller');
const schemas = require('./admin.validation');
const validate = require('../../middlewares/validate');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');

const router = Router();

router.use(authenticate, authorizeStaff('support', 'admin', 'super_admin'));

router.get('/analytics/overview', validate({ query: schemas.overview }), controller.overview);
router.post(
  '/virtuals/reconcile-bet',
  authorizeStaff('admin', 'super_admin'),
  validate({ body: schemas.reconcileVirtualBet }),
  controller.reconcileVirtualBet
);

module.exports = router;
