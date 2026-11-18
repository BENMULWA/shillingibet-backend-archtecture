'use strict';

// Find players holding money they never deposited or won, flag them, and zero the balance.
//
//   node src/scripts/flagUnfundedBalances.js                          # dry run: list only
//   node src/scripts/flagUnfundedBalances.js --apply --by 2547XXXXXXXX
//
// A balance counts as unfunded when the player has no completed deposit, no sportsbook bet,
// no virtual-game activity, no cashback award, no referral earnings and no recorded staff credit.
// --apply zeroes balance + bonusBalance through the normal admin "zero balance" action (which
// writes a BalanceAdjustment record) and adds a flagged entry to the admin audit log.

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const User = require('../domains/user/user.model');
const Transaction = require('../domains/transaction/transaction.model');
const Bet = require('../domains/bet/bet.model');
const VirtualTxn = require('../domains/virtual/virtualTxn.model');
const CashbackAward = require('../domains/cashback/cashbackAward.model');
const BalanceAdjustment = require('../domains/admin/balanceAdjustment.model');
const AdminAudit = require('../domains/admin/adminAudit.model');
const managementService = require('../domains/admin/admin.management.service');
const { getStaffLevel } = require('../middlewares/auth');
const { normalizePhone } = require('../utils/phone');

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const byPhone = argValue('--by');
const REASON = 'Flagged: balance with no deposit, bets, wins or recorded credit. Reset to 0 pending investigation.';

(async () => {
  await connectDatabase();
  try {
    console.log(`Database: ${mongoose.connection.host}/${mongoose.connection.name}\n`);

    let actor = null;
    if (apply) {
      if (!byPhone) throw new Error('--by <super admin phone> is required with --apply');
      actor = await User.findOne({ phone: normalizePhone(byPhone) }).lean();
      if (!actor || getStaffLevel(actor) !== 'super_admin') throw new Error(`${byPhone} is not a super admin`);
    }

    const holders = await User.find({
      role: 'user',
      deletedAt: null,
      $or: [{ balance: { $gt: 0 } }, { bonusBalance: { $gt: 0 } }],
    })
      .select('phone name balance bonusBalance status createdAt referralStats')
      .sort({ balance: -1 })
      .lean();

    console.log(`Checking ${holders.length} player(s) with a balance...`);
    const ids = holders.map((u) => u._id);
    const funded = new Set(
      (
        await Promise.all([
          Transaction.distinct('user', { user: { $in: ids }, type: 'deposit', status: 'completed' }),
          Bet.distinct('user', { user: { $in: ids } }),
          VirtualTxn.distinct('user', { user: { $in: ids } }),
          CashbackAward.distinct('user', { user: { $in: ids } }),
          BalanceAdjustment.distinct('user', { user: { $in: ids }, type: 'admin_credit' }),
        ])
      )
        .flat()
        .map(String)
    );
    const flagged = holders.filter(
      (u) => !funded.has(String(u._id)) && !(Number(u.referralStats?.bonusEarned || 0) > 0)
    );

    const total = flagged.reduce((t, u) => t + Number(u.balance || 0) + Number(u.bonusBalance || 0), 0);
    console.log(`${holders.length} player(s) hold money; ${flagged.length} have no deposit, play, win or credit (KES ${total}):`);
    for (const u of flagged) {
      console.log(
        `  ${String(u.phone).padEnd(13)} balance ${String(u.balance || 0).padStart(10)}  bonus ${String(u.bonusBalance || 0).padStart(8)}  ${u.status.padEnd(9)} created ${u.createdAt.toISOString().slice(0, 10)}  ${u.name || ''}`
      );
    }

    if (!apply) {
      console.log('\nDry run: nothing changed. Add --apply --by <super admin phone> to flag and zero them.');
      return;
    }

    for (const u of flagged) {
      const { adjustment } = await managementService.zeroUserBalance(actor, u._id, REASON);
      await AdminAudit.create({
        actor: actor._id,
        actorPhone: actor.phone,
        actorRole: getStaffLevel(actor),
        action: 'player_balance_flagged_unfunded',
        category: 'write',
        method: 'SCRIPT',
        path: 'scripts/flagUnfundedBalances.js',
        outcome: 'success',
        statusCode: 200,
        targetUser: u._id,
        reason: REASON,
        changes: {
          phone: u.phone,
          balanceBefore: u.balance || 0,
          bonusBalanceBefore: u.bonusBalance || 0,
          balanceAfter: 0,
          adjustmentId: adjustment._id,
        },
      });
      console.log(`  zeroed + flagged ${u.phone} (was KES ${u.balance || 0})`);
    }
  } finally {
    await disconnectDatabase();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
