'use strict';

const { Router } = require('express');
const validate = require('../../middlewares/validate');
const controller = require('./announcement.controller');
const schemas = require('./announcement.validation');

// Public: players read the latest announcements. Posting and removing are in the admin routes.
const router = Router();
router.get('/', validate({ query: schemas.list }), controller.list);

module.exports = router;
