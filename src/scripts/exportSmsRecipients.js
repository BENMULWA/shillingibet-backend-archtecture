'use strict';

// Phone numbers for a bulk SMS, one per line, ready to paste into Bulk SMS on the dashboard.
// Read-only. Players only: active, phone verified, not staff, valid Kenyan mobile number.
//
//   node src/scripts/exportSmsRecipients.js                         # writes sms-recipients.txt
//   node src/scripts/exportSmsRecipients.js --out /tmp/players.txt
//   node src/scripts/exportSmsRecipients.js --include-unverified
//
// The file holds phone numbers only. It is personal data: delete it after sending.

require('dotenv').config();
const fs = require('fs');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const User = require('../domains/user/user.model');

const includeUnverified = process.argv.includes('--include-unverified');
const outIndex = process.argv.indexOf('--out');
const outFile = outIndex > -1 ? process.argv[outIndex + 1] : 'sms-recipients.txt';

(async () => {
  await connectDatabase();
  try {
    const filter = {
      deletedAt: null,
      status: 'active',
      isStaff: { $ne: true },
      phone: /^254[17]\d{8}$/,
      ...(includeUnverified ? {} : { phoneVerified: true }),
    };
    const phones = await User.distinct('phone', filter);
    phones.sort();
    fs.writeFileSync(outFile, `${phones.join('\n')}\n`, { mode: 0o600 });
    console.log(`Wrote ${phones.length} number(s)${includeUnverified ? ' (including unverified)' : ''} to ${outFile}`);
  } finally {
    await disconnectDatabase();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
