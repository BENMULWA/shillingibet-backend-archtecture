'use strict';

// Turn an existing account (e.g. a player account on the staff member's own phone) into a
// staff account, instead of deleting it and losing its transaction history.
//
//   STAFF_PASSWORD='temporary-password' node src/scripts/makeStaff.js \
//     --phone 0741698820 --role admin --name "Rose Ngati" --email gati@example.com --by 2547XXXXXXXX
//
// The password is read from STAFF_PASSWORD so it stays out of the command arguments.
// Add --dry-run to see what would change.

require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/database');
const User = require('../domains/user/user.model');
const AdminAudit = require('../domains/admin/adminAudit.model');
const staffRoles = require('../domains/admin/staffRole.service');
const { getStaffLevel } = require('../middlewares/auth');
const { normalizePhone } = require('../utils/phone');

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes('--dry-run');
const phone = normalizePhone(argValue('--phone'));
const role = argValue('--role');
const name = argValue('--name');
const email = argValue('--email');
const byPhone = argValue('--by');
const password = process.env.STAFF_PASSWORD;

(async () => {
  if (!phone || !role || !byPhone) throw new Error('--phone, --role and --by are required');
  if (!dryRun && (!password || password.length < 8)) throw new Error('Set STAFF_PASSWORD (at least 8 characters)');

  await connectDatabase();
  try {
    await staffRoles.ensureDefaultRoles();
    await staffRoles.assertRoleExists(role);

    const actor = await User.findOne({ phone: normalizePhone(byPhone) }).lean();
    if (!actor || getStaffLevel(actor) !== 'super_admin') throw new Error(`${byPhone} is not a super admin`);

    const user = await User.findOne({ phone, deletedAt: null }).select('+password');
    if (!user) throw new Error(`No account with phone ${phone}. Use Add Staff on the dashboard instead.`);
    if (String(user._id) === String(actor._id)) throw new Error('You cannot change your own account');

    const before = { role: user.role, isStaff: user.isStaff, adminLevel: user.adminLevel, status: user.status, name: user.name, email: user.email };
    console.log(`Found ${user.phone}: ${JSON.stringify(before)} balance=${user.balance || 0}`);
    if (dryRun) {
      console.log(`Dry run: would make it staff with role "${role}". Nothing changed.`);
      return;
    }

    user.isStaff = true;
    user.adminLevel = role;
    user.status = 'active';
    user.phoneVerified = true;
    if (name) user.name = name;
    if (email) user.email = email;
    user.password = password; // hashed by the model's save hook
    await user.save();

    await AdminAudit.create({
      actor: actor._id,
      actorPhone: actor.phone,
      actorRole: getStaffLevel(actor),
      action: 'staff.promote_existing_account',
      category: 'write',
      method: 'SCRIPT',
      path: 'scripts/makeStaff.js',
      outcome: 'success',
      statusCode: 200,
      targetUser: user._id,
      changes: { before, after: { role: user.role, isStaff: true, adminLevel: role, status: 'active', name: user.name, email: user.email } },
    });

    console.log(`Done: ${user.phone} is now staff with role "${role}". They sign in with this phone and the temporary password.`);
  } finally {
    await disconnectDatabase();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
