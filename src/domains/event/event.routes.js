'use strict';

const { Router } = require('express');
const controller = require('./event.controller');
const schemas = require('./event.validation');
const validate = require('../../middlewares/validate');
const { authenticate, requirePermission } = require('../../middlewares/auth');

const router = Router();

router.get('/', validate({ query: schemas.list }), controller.list);
router.get('/:id', controller.getById);

router.post('/', authenticate, requirePermission('events.manage'), validate({ body: schemas.create }), controller.create);
router.post(
  '/:id/settle',
  authenticate,
  requirePermission('events.manage'),
  validate({ body: schemas.settle }),
  controller.settle
);

module.exports = router;
