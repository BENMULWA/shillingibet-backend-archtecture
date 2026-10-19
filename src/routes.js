'use strict';

const { Router } = require('express');
const userRoutes = require('./domains/user/user.routes');
const eventRoutes = require('./domains/event/event.routes');
const betRoutes = require('./domains/bet/bet.routes');
const transactionRoutes = require('./domains/transaction/transaction.routes');
const virtualRoutes = require('./domains/virtual/virtual.routes');
const adminRoutes = require('./domains/admin/admin.routes');
const walletRoutes = require('./domains/wallet/wallet.routes');

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'ok', uptime: process.uptime() });
});

router.use('/users', userRoutes);
router.use('/events', eventRoutes);
router.use('/bets', betRoutes);
router.use('/transactions', transactionRoutes);
router.use('/wallet', walletRoutes);
router.use('/virtuals', virtualRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
