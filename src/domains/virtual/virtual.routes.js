'use strict';

const { Router } = require('express');
const controller = require('./virtual.controller');
const verifyEurovirtuals = require('../../middlewares/verifyEurovirtuals');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');
const { launchLimiter } = require('../../middlewares/rateLimiter');

const router = Router();

router.post('/player_info', verifyEurovirtuals, controller.playerInfo);
router.post('/bet', verifyEurovirtuals, controller.bet);
router.post('/win', verifyEurovirtuals, controller.win);
router.post('/rollback', verifyEurovirtuals, controller.rollback);

router.get('/games', authenticate, controller.getGames);
router.post('/launch', authenticate, launchLimiter, controller.launch);
router.get('/bet/status/:game_uuid', authenticate, controller.getBetStatus);
router.post('/shortcode/:game_uuid', authenticate, authorizeStaff('admin', 'super_admin'), controller.shortcode);

module.exports = router;
