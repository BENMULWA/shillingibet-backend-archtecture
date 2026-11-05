'use strict';

const { Router } = require('express');
const { authenticate, authorizeStaff } = require('../../middlewares/auth');
const adminAudit = require('../../middlewares/adminAudit');
const validate = require('../../middlewares/validate');
const controller = require('./supportAdmin.controller');
const schemas = require('./supportAdmin.validation');

const router = Router();
router.use(authenticate, adminAudit);

router.get(
  '/agent/online-agents',
  authorizeStaff('support', 'admin', 'super_admin'),
  controller.listOnlineAgents
);

router.use(authorizeStaff('super_admin'));

router.get('/superadmin/agents', validate({ query: schemas.agents }), controller.listAgents);
router.patch(
  '/superadmin/agents/:userId/ban',
  validate({ params: schemas.agentParams, body: schemas.agentBan }),
  controller.setAgentBan
);
router.get('/superadmin/sessions', validate({ query: schemas.sessions }), controller.listSessions);
router.get(
  '/superadmin/sessions/:sessionId',
  validate({ params: schemas.sessionParams }),
  controller.getSession
);

module.exports = router;
