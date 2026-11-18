'use strict';

// Investigate and reset the payout float.
//
//   node src/scripts/resetPayoutFloat.js                                   # dry run: show float + who allocated it
//   node src/scripts/resetPayoutFloat.js --apply --by 2547XXXXXXXX --reason "Unauthorised allocation"
//
// --apply sets the available balance to 0 and writes a flagged entry in the admin audit log
// (action `payout_float_reset_flagged`) recording the old values and every allocation found.
// Reservations held by in-flight withdrawals are left alone so those payouts still settle.

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const PayoutFloat = require('../domains/admin/payoutFloat.model');
const AdminAudit = require('../domains/admin/adminAudit.model');
const User = require('../domains/user/user.model');
const { normalizePhone } = require('../utils/phone');

const FLOAT_ID = 'payout-float';
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const byPhone = argValue('--by');
const reason = argValue('--reason') || 'Payout float reset to 0: unauthorised or unexpected allocation';

(async () => {
  await connectDatabase();
  try {
    console.log(`Database: ${mongoose.connection.host}/${mongoose.connection.name}\n`);

    const float = await PayoutFloat.findById(FLOAT_ID).populate('updatedBy', 'phone name adminLevel').lean();
    if (!float) {
      console.log('No payout float document exists yet (collection payoutfloats, _id "payout-float").');
      return;
    }
    const reserved = (float.reservations || []).reduce((t, r) => t + Number(r.amount || 0), 0);
    console.log('payoutfloats { _id: "payout-float" }');
    console.log(`  balance         KES ${float.balance}`);
    console.log(`  totalAllocated  KES ${float.totalAllocated}`);
    console.log(`  reserved        KES ${reserved} (${(float.reservations || []).length} in-flight withdrawal(s))`);
    console.log(`  last updatedBy  ${float.updatedBy ? `${float.updatedBy.phone} ${float.updatedBy.name || ''} (${float.updatedBy.adminLevel || '-'})` : '-'}`);
    console.log(`  updatedAt       ${float.updatedAt?.toISOString?.() || float.updatedAt}\n`);

    const allocations = await AdminAudit.find({
      method: 'POST',
      path: /\/admin\/treasury\/withdrawals\/allocations$/,
    })
      .sort({ createdAt: 1 })
      .lean();

    let auditedTotal = 0;
    console.log(`Allocation requests in admin audit log: ${allocations.length}`);
    for (const a of allocations) {
      const amount = Number(a.details?.body?.amount || 0);
      if (a.outcome === 'success') auditedTotal += amount;
      console.log(
        `  ${a.createdAt.toISOString()}  ${a.outcome.padEnd(7)}  KES ${String(amount).padStart(12)}  by ${a.actorPhone} (${a.actorRole})  ip=${a.ipAddress || '-'}  note=${a.details?.body?.note || '-'}`
      );
    }
    // Repeated idempotency keys are not added twice, so a retried request can make this slightly high.
    const unexplained = Number(float.totalAllocated || 0) - auditedTotal;
    console.log(`\nSuccessful audited allocations: KES ${auditedTotal}`);
    if (Math.abs(unexplained) > 0.01) {
      console.log(`WARNING: totalAllocated differs from audited allocations by KES ${unexplained}.`);
      console.log('         Part of the float was set outside the API (direct DB edit or before auditing existed).');
    }

    if (!apply) {
      console.log('\nDry run: nothing changed. Add --apply --by <your staff phone> to reset the balance to 0.');
      return;
    }

    if (!byPhone) throw new Error('--by <staff phone> is required with --apply');
    const actor = await User.findOne({ phone: normalizePhone(byPhone) }).lean();
    if (!actor) throw new Error(`No user with phone ${byPhone}`);

    const before = { balance: float.balance, totalAllocated: float.totalAllocated, reserved };
    await PayoutFloat.updateOne({ _id: FLOAT_ID }, { $set: { balance: 0, updatedBy: actor._id } });

    await AdminAudit.create({
      actor: actor._id,
      actorPhone: actor.phone,
      actorRole: actor.adminLevel || actor.role,
      action: 'payout_float_reset_flagged',
      category: 'write',
      method: 'SCRIPT',
      path: 'scripts/resetPayoutFloat.js',
      outcome: 'success',
      statusCode: 200,
      reason,
      changes: {
        before,
        after: { balance: 0, totalAllocated: float.totalAllocated, reserved },
        flaggedAllocations: allocations.map((a) => ({
          auditId: a._id,
          at: a.createdAt,
          amount: a.details?.body?.amount,
          by: a.actorPhone,
          ip: a.ipAddress,
          outcome: a.outcome,
        })),
        unauditedAmount: unexplained,
      },
    });

    console.log(`\nReset: balance KES ${float.balance} -> 0. Flag written to adminaudits (action payout_float_reset_flagged).`);
  } finally {
    await disconnectDatabase();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
