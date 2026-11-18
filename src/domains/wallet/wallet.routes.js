'use strict';

const { Router } = require('express');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { depositLimiter, withdrawalLimiter } = require('../../middlewares/rateLimiter');
const controller = require('./wallet.controller');
const schemas = require('./wallet.validation');
const { withdrawalChargeRules } = require('../transaction/withdrawalCharges');

const router = Router();

// Withdrawal tax and fee rules, so the site shows the same deductions the backend applies.
router.get('/charges', (_req, res) => {
  res.json({ success: true, message: 'OK', data: withdrawalChargeRules() });
});

router.use(authenticate);

router.post(
  '/billOrder',
  depositLimiter,
  validate({ body: schemas.billOrder }),
  controller.billOrder,
);

router.post(
  '/comet/withdraw',
  withdrawalLimiter,
  validate({ body: schemas.cometWithdraw }),
  controller.cometWithdraw,
);

router.post(
  '/card-link',
  depositLimiter,
  validate({ body: schemas.cardLink }),
  controller.cardLink,
);

router.get('/celo/deposit', controller.celoDeposit);
router.get('/celo/deposit/sync', depositLimiter, controller.celoSync);

router.post(
  '/celo/withdraw',
  withdrawalLimiter,
  validate({ body: schemas.celoWithdraw }),
  controller.celoWithdraw,
);


module.exports = router;
