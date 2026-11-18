'use strict';

// One-off clean-up before going live.
//
//   node src/scripts/cleanupPendingAndBlocked.js                       # dry run: list everything
//   node src/scripts/cleanupPendingAndBlocked.js --apply --by 2547XXXXXXXX
//
// 1. Pending withdrawals are closed:
//    - M-Pesa ones are checked with Mamlaka first. If Mamlaka says it was paid, it is marked
//      completed (no refund). Otherwise it is marked failed.
//    - A failed withdrawal is refunded to the wallet ONLY if that wallet passes the balance
//      integrity check. Unbacked (anomalous) accounts get no refund: that money was never real.
//    - The payout float reservation is released either way.
// 2. Suspended accounts that still hold money are zeroed (with a BalanceAdjustment record).
// Every change is written to the admin audit log.

require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/database');
const User = require('../domains/user/user.model');
const Transaction = require('../domains/transaction/transaction.model');
const AdminAudit = require('../domains/admin/adminAudit.model');
const mamlaka = require('../integrations/mamlaka/mamlaka.client');
const payoutFloatService = require('../domains/admin/payoutFloat.service');
const managementService = require('../domains/admin/admin.management.service');
const balanceIntegrity = require('../domains/admin/balanceIntegrity.service');
const { incWalletBalance } = require('../utils/db');
const { getStaffLevel } = require('../middlewares/auth');
const { normalizePhone } = require('../utils/phone');

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const byPhone = argValue('--by');
const isMpesa = (t) => ['m-pesa', 'mpesa'].includes(String(t.provider || '').toLowerCase());

const providerStatus = async (txn) => {
  if (!isMpesa(txn)) return { status: 'unverifiable', note: `${txn.provider} has no status lookup` };
  try {
    const res = await mamlaka.getTransactionStatus(txn.secureId || txn.externalId);
    const s = String(res.transactionStatus || '').toUpperCase();
    if (['SUCCESS', 'SUCCESSFUL', 'COMPLETE', 'COMPLETED', 'PAID'].includes(s)) return { status: 'paid', receipt: res.transactionReceipt, note: s };
    return { status: 'not_paid', note: s || 'no status' };
  } catch (error) {
    return { status: 'not_paid', note: `lookup failed: ${error.message}` };
  }
};

(async () => {
  await connectDatabase();
  try {
    let actor = null;
    if (apply) {
      if (!byPhone) throw new Error('--by <super admin phone> is required with --apply');
      actor = await User.findOne({ phone: normalizePhone(byPhone) }).lean();
      if (!actor || getStaffLevel(actor) !== 'super_admin') throw new Error(`${byPhone} is not a super admin`);
    }
    const audit = (action, targetUser, changes, reason) =>
      AdminAudit.create({
        actor: actor._id, actorPhone: actor.phone, actorRole: 'super_admin', action, category: 'write',
        method: 'SCRIPT', path: 'scripts/cleanupPendingAndBlocked.js', outcome: 'success', statusCode: 200,
        targetUser, changes, reason,
      });

    const pending = await Transaction.find({ type: 'withdrawal', status: 'pending' }).sort({ createdAt: 1 }).lean();
    console.log(`\n${pending.length} pending withdrawal(s):`);
    const integrityCache = new Map();
    for (const txn of pending) {
      const key = String(txn.user);
      if (!integrityCache.has(key)) integrityCache.set(key, await balanceIntegrity.checkUser(txn.user));
      const integrity = integrityCache.get(key);
      const provider = await providerStatus(txn);
      const refund = provider.status !== 'paid' && integrity && !integrity.anomalous;
      const outcome = provider.status === 'paid'
        ? 'mark COMPLETED (provider paid it)'
        : refund ? 'mark FAILED + refund wallet'
        : `mark FAILED, NO refund (${integrity ? `unbacked: KES ${integrity.excess} unexplained` : 'account not found'})`;
      console.log(`  ${txn.createdAt.toISOString().slice(0, 10)} ${txn.phone} ${txn.provider} KES ${txn.amount} [${provider.note}] -> ${outcome}`);
      if (!apply) continue;

      const now = new Date();
      if (provider.status === 'paid') {
        await Transaction.updateOne({ _id: txn._id, status: 'pending' }, { $set: { status: 'completed', completedAt: now, receipt: txn.receipt || provider.receipt || null } });
        await payoutFloatService.settlePayout(txn.externalId);
      } else {
        const reason = refund ? 'Closed during pre-launch clean-up; amount refunded' : 'Closed during pre-launch clean-up; unbacked account, not refunded';
        const res = await Transaction.updateOne(
          { _id: txn._id, status: 'pending' },
          { $set: { status: 'failed', failureReason: reason, completedAt: now, ...(refund ? { walletAppliedAt: now } : {}) } }
        );
        if (res.modifiedCount && refund) await User.updateOne({ _id: txn.user }, incWalletBalance(txn.walletType || 'balance', txn.amount));
        await payoutFloatService.settlePayout(txn.externalId, { refund: true });
      }
      await audit('withdrawal.cleanup', txn.user, { externalId: txn.externalId, amount: txn.amount, provider: txn.provider, outcome }, 'Pre-launch clean-up of pending withdrawals');
    }

    const blocked = await User.find({ status: 'suspended', deletedAt: null, $or: [{ balance: { $gt: 0 } }, { airtimeBalance: { $gt: 0 } }] }).select('phone balance airtimeBalance').lean();
    console.log(`\n${blocked.length} suspended account(s) still holding money:`);
    for (const u of blocked) {
      const integrity = await balanceIntegrity.checkUser(u._id);
      console.log(`  ${u.phone} balance ${u.balance} airtime ${u.airtimeBalance || 0} (history explains ${integrity?.expected}) -> zero`);
      if (!apply) continue;
      await managementService.zeroUserBalance(actor, u._id, 'Suspended account frozen to zero during pre-launch clean-up');
      await audit('player.freeze_suspended', u._id, { balanceBefore: u.balance, expected: integrity?.expected }, 'Suspended account frozen to zero');
    }

    // 3. Anomalous accounts (balance not explained by their history) that still hold money:
    //    zeroed and withdrawals paused. Staff accounts are listed but left for manual review.
    const { anomalies } = await balanceIntegrity.scanAll();
    const holding = anomalies.filter((a) => a.actual > 0);
    console.log(`\n${anomalies.length} anomalous account(s); ${holding.length} still holding money:`);
    for (const a of holding) {
      const u = await User.findById(a.userId).select('isStaff adminLevel').lean();
      const staff = Boolean(u?.isStaff || u?.adminLevel);
      console.log(`  ${a.phone} holds ${a.actual}, history explains ${a.expected} (KES ${a.excess} unexplained) -> ${staff ? 'STAFF account: left for manual review' : 'zero + pause withdrawals'}`);
      if (!apply || staff) continue;
      await managementService.zeroUserBalance(actor, a.userId, `Anomalous balance: KES ${a.excess} not explained by deposits, play or recorded credits`);
      await User.updateOne({ _id: a.userId }, { $set: { withdrawalPaused: true } });
      await audit('player.freeze_anomalous', a.userId, { balanceBefore: a.actual, expected: a.expected, excess: a.excess, parts: a.parts }, 'Anomalous balance frozen to zero');
    }
    for (const a of anomalies.filter((x) => x.actual <= 0 && !x.withdrawalPaused)) {
      if (apply) await User.updateOne({ _id: a.userId }, { $set: { withdrawalPaused: true } });
    }

    if (!apply) console.log('\nDry run: nothing changed. Add --apply --by <super admin phone> to apply.');
  } finally {
    await disconnectDatabase();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
