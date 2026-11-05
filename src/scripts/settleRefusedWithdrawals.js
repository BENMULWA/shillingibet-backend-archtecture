'use strict';

// One-off clean-up: refund withdrawals that the payment provider refused outright
// (its reply was FAILED) but that were left "pending", holding the player's money.
//
//   node src/scripts/settleRefusedWithdrawals.js            # dry run: only lists them
//   node src/scripts/settleRefusedWithdrawals.js --apply    # refunds them
//
// It never touches pending withdrawals the provider did not refuse (no reply, or "success"
// without a confirmation): those may already have been paid out and need a manual check.

require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/database');
const Transaction = require('../domains/transaction/transaction.model');
const transactionService = require('../domains/transaction/transaction.service');

const apply = process.argv.includes('--apply');

const mask = (phone) => (phone ? `******${String(phone).slice(-4)}` : '-');

(async () => {
  await connectDatabase();
  try {
    const pending = await Transaction.find({ type: 'withdrawal', status: 'pending' }).lean();
    const refused = pending.filter(
      (txn) => String(txn.providerResponse?.transactionStatus || txn.providerResponse?.status || '').toUpperCase() === 'FAILED',
    );

    console.log(`${pending.length} pending withdrawal(s); ${refused.length} refused by the provider.`);
    if (!apply) console.log('Dry run: nothing changed. Add --apply to refund the refused ones.');

    for (const txn of refused) {
      const label = `${txn._id} ${txn.currency} ${txn.amount} ${txn.walletType || 'balance'} ${mask(txn.phone)}`;
      if (!apply) {
        console.log(`  would refund: ${label}`);
        continue;
      }
      const done = await transactionService.settleRejectedWithdrawal(txn);
      console.log(`  ${done ? 'refunded' : 'skipped '}: ${label}`);
    }
  } finally {
    await disconnectDatabase();
  }
})().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
