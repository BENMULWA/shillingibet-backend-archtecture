'use strict';

// History of payout float funding, built from the admin audit log (immutable).
// Covers dashboard allocations, resets and corrections. Allocations made from now on also
// carry the float before/after and the real Mamlaka payout balance at that moment, so each
// allocation can be matched to a top-up on the Mamlaka statement.

const AdminAudit = require('./adminAudit.model');

const FLOAT_ACTIONS = ['payout_float_allocation', 'payout_float_reset_flagged', 'payout_float_correction'];
const num = (v) => (v == null || v === '' ? null : Number(v));

const toMovement = (a) => {
  const c = a.changes || {};
  const body = a.details?.body || {};
  const isReset = a.action === 'payout_float_reset_flagged';
  const before = num(c.before?.balance ?? c.before);
  const after = num(c.after?.balance ?? c.after);
  const amount = isReset
    ? -(before || 0)
    : num(c.amount ?? body.amount) ?? (before != null && after != null ? after - before : null);
  return {
    id: a._id,
    at: a.createdAt,
    type: isReset ? 'reset' : a.action === 'payout_float_correction' ? 'correction' : 'allocation',
    amount,
    floatBefore: before,
    floatAfter: after,
    mamlakaPayoutKes: num(c.mamlakaPayoutKes),
    by: a.actorPhone,
    note: a.reason || body.note || null,
    outcome: a.outcome,
  };
};

const listMovements = async ({ limit = 200 } = {}) => {
  const rows = await AdminAudit.find({
    $or: [
      { method: 'POST', path: /\/admin\/treasury\/withdrawals\/allocations$/ },
      { action: { $in: FLOAT_ACTIONS } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 200, 1000))
    .lean();
  return rows.map(toMovement);
};

module.exports = { listMovements, toMovement };
