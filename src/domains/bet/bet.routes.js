'use strict';

const { Router } = require('express');
const controller = require('./bet.controller');
const schemas = require('./bet.validation');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');

const router = Router();

router.use(authenticate);

router.post('/', validate({ body: schemas.place }), controller.place);
router.get('/', validate({ query: schemas.list }), controller.list);
router.get('/:id', controller.getById);

module.exports = router;
