'use strict';

const { Router } = require('express');
const controller = require('./event.controller');
const schemas = require('./event.validation');
const validate = require('../../middlewares/validate');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');

const router = Router();

router.get('/', validate({ query: schemas.list }), controller.list);
router.get('/:id', controller.getById);

router.post('/', authenticate, authorizeStaff('admin', 'super_admin'), validate({ body: schemas.create }), controller.create);
router.post(
  '/:id/settle',
  authenticate,
  authorizeStaff('admin', 'super_admin'),
  validate({ body: schemas.settle }),
  controller.settle
);

module.exports = router;
