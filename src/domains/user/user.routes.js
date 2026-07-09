'use strict';

const { Router } = require('express');
const controller = require('./user.controller');
const schemas = require('./user.validation');
const validate = require('../../middlewares/validate');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');
const { authLimiter } = require('../../middlewares/rateLimiter');

const router = Router();

router.post('/register', authLimiter, validate({ body: schemas.register }), controller.register);
router.post('/login', authLimiter, validate({ body: schemas.login }), controller.login);
router.post('/verify-phone', authLimiter, validate({ body: schemas.verifyPhone }), controller.verifyPhone);
router.post('/resend-phone-code', authLimiter, validate({ body: schemas.resendPhoneCode }), controller.resendPhoneCode);
router.post('/request-password-reset', authLimiter, validate({ body: schemas.requestPasswordReset }), controller.requestPasswordReset);
router.post('/reset-password', authLimiter, validate({ body: schemas.resetPassword }), controller.resetPassword);
router.post('/staff-login', authLimiter, validate({ body: schemas.login }), controller.staffLogin);

router.get('/me', authenticate, controller.me);
router.patch(
  '/wallet/active',
  authenticate,
  validate({ body: schemas.activeWallet }),
  controller.setActiveWallet
);
router.patch(
  '/:id/staff-access',
  authenticate,
  authorizeStaff('super_admin'),
  validate({ body: schemas.staffAccess }),
  controller.updateStaffAccess
);
router.post(
  '/credit',
  authenticate,
  authorizeStaff('admin', 'super_admin'),
  validate({ body: schemas.credit }),
  controller.credit
);

module.exports = router;
