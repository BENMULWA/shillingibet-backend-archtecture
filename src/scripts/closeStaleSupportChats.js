'use strict';

// Close support chats that have been waiting for an agent for a long time (customers who
// wrote once and left). They bury real, fresh chats in the agent queue.
//
//   node src/scripts/closeStaleSupportChats.js              # dry run, 7 days: only lists
//   node src/scripts/closeStaleSupportChats.js --days=14    # use another age
//   node src/scripts/closeStaleSupportChats.js --apply      # really close them
//
// Only chats still "waiting" with no activity for the given number of days are touched.
// Chats an agent has accepted are never changed. The messages are kept; a customer who
// comes back simply starts a fresh chat.

require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/database');
const SupportSession = require('../domains/support/supportSession.model');

const apply = process.argv.includes('--apply');
const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const days = Math.max(1, Number(daysArg?.split('=')[1]) || 7);

const mask = (phone) => (phone ? `…${String(phone).slice(-4)}` : '-');

(async () => {
  await connectDatabase();
  try {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const filter = { status: 'waiting', lastMessageAt: { $lt: cutoff } };

    const stale = await SupportSession.find(filter).sort({ lastMessageAt: 1 }).lean();
    const waitingTotal = await SupportSession.countDocuments({ status: 'waiting' });
    console.log(`${waitingTotal} chat(s) waiting; ${stale.length} idle for more than ${days} day(s).`);
    if (stale.length) {
      const oldest = stale[0];
      const newest = stale[stale.length - 1];
      console.log(`  oldest: ${mask(oldest.customer?.phone)} ${new Date(oldest.lastMessageAt).toISOString().slice(0, 10)}`);
      console.log(`  newest of the stale: ${mask(newest.customer?.phone)} ${new Date(newest.lastMessageAt).toISOString().slice(0, 10)}`);
    }

    if (!apply) {
      console.log('Dry run: nothing changed. Add --apply to close them.');
      return;
    }
    const result = await SupportSession.updateMany(filter, {
      $set: { status: 'closed', open: false, closedAt: new Date() },
    });
    console.log(`Closed ${result.modifiedCount} chat(s).`);
  } finally {
    await disconnectDatabase();
  }
})().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
