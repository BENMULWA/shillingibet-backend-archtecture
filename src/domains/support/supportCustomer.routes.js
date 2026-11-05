'use strict';

const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const supportStore = require('./supportSession.store');

// A player's own support conversations (past and current). Mounted at /support-chat/me.
const router = Router();
router.use(authenticate);

router.get(
  '/chats',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await supportStore.listForCustomer(req.user._id) });
  })
);

router.get(
  '/chats/:sessionId',
  validate({ params: z.object({ sessionId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const chat = await supportStore.getForCustomer(req.user._id, req.params.sessionId);
    if (!chat) throw ApiError.notFound('Chat not found');
    sendSuccess(res, { data: chat });
  })
);

module.exports = router;
