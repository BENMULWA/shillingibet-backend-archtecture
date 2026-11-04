'use strict';

/**
 * Backfills schema fields that are missing from legacy user documents.
 *
 * Why this matters: MongoDB only applies Mongoose defaults when a document is
 * created (or explicitly validated). Users created before a field was added to
 * the schema have NO such field in the raw document — reading the doc through
 * Mongoose shows the default, but a raw query / `$gte` filter against the
 * missing field never matches.
 *
 * A concrete failure this prevents: a balance filter of
 * `{ airtimeBalance: { $gte: 10 } }` cannot match a document where
 * `airtimeBalance` is absent, so the user is told "insufficient balance"
 * even though the account is funded.
 *
 * Safety rules for this script:
 *   - It only ever fills MISSING leaves. It never overwrites an existing
 *     value, and it never clobbers a sibling key inside an object field.
 *   - It is idempotent — running it twice changes nothing the second time.
 *   - It is a no-op until you pass --apply.
 *   - Every document it touches is written to a rollback manifest so the
 *     change can be undone.
 *
 * Usage:
 *   node src/scripts/backfillUserFields.js            # dry run (default)
 *   node src/scripts/backfillUserFields.js --apply    # write to the database
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../utils/logger');

const APPLY = process.argv.includes('--apply');
const REPORT_EVERY = 200;
const MANIFEST_DIR = path.resolve(__dirname, '../../logs');

// Leaf-level paths: every entry mirrors the corresponding default in
// src/domains/user/user.model.js. Working at leaf level means adding a new
// sibling key to an object field never overwrites the keys already there.
const LEAF_DEFAULTS = [
  { path: 'airtimeBalance', value: 0 },
  { path: 'activeWallet', value: 'balance' },
  { path: 'celoSweptBalances.USDT', value: 0 },
  { path: 'celoSweptBalances.USDC', value: 0 },
  { path: 'celoSweptBalances.cUSD', value: 0 },
  { path: 'referredBy', value: null },
  { path: 'referredAt', value: null },
  { path: 'referralStats.referredUsersCount', value: 0 },
  { path: 'referralStats.bonusEarned', value: 0 },
  { path: 'referralReward.qualifyingDepositAt', value: null },
  { path: 'referralReward.bonusGrantedAt', value: null },
  { path: 'resetPassword', value: {} },
];

// phoneVerification needs a slightly different treatment: an account already
// flagged phoneVerified should carry a verifiedAt timestamp, otherwise code
// that reads phoneVerification.verifiedAt treats a verified account as
// unverified. For those we fall back to the account's creation time, which is
// always <= the real verification time, so nothing expires early.
const VERIFIED_AT_FALLBACK = true;

/** Reads a dotted path out of a raw BSON document. Returns undefined if absent. */
const readPath = (doc, dotted) =>
  dotted.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), doc);

/** True when the leaf (or any of its parents) is absent from the document. */
const isMissing = (doc, dotted) => readPath(doc, dotted) === undefined;

const missingFilters = () => [
  ...LEAF_DEFAULTS.map((leaf) => ({ [leaf.path]: { $exists: false } })),
  { phoneVerification: { $exists: false } },
];

const countMissing = async (collection) => {
  const counts = {};
  for (const leaf of LEAF_DEFAULTS) {
    counts[leaf.path] = await collection.countDocuments({ [leaf.path]: { $exists: false } });
  }
  counts.phoneVerification = await collection.countDocuments({ phoneVerification: { $exists: false } });
  return counts;
};

/**
 * Builds the $set payload for one document, containing only the leaves that
 * are actually missing. Returns null when the document is already complete.
 */
const buildSet = (user) => {
  const set = {};

  for (const leaf of LEAF_DEFAULTS) {
    if (isMissing(user, leaf.path)) set[leaf.path] = leaf.value;
  }

  if (user.phoneVerification === undefined) {
    set.phoneVerification =
      VERIFIED_AT_FALLBACK && user.phoneVerified === true
        ? { verifiedAt: user.createdAt || new Date() }
        : {};
  }

  return Object.keys(set).length ? set : null;
};

async function backfill() {
  await connectDatabase();
  const collection = mongoose.connection.db.collection('users');

  const before = await countMissing(collection);
  logger.info('Missing-field counts BEFORE backfill', before);

  const totalMissing = Object.values(before).reduce((sum, n) => sum + n, 0);
  if (totalMissing === 0) {
    logger.info('Nothing to backfill — every user document already has the schema fields.');
    await disconnectDatabase();
    return;
  }

  if (!APPLY) {
    logger.warn('DRY RUN — nothing written. Re-run with --apply to write.');
    logger.warn(`Total missing field instances across all users: ${totalMissing}`);
    await disconnectDatabase();
    return;
  }

  const manifest = [];
  const cursor = collection.find({ $or: missingFilters() });
  let processed = 0;
  let operations = [];

  const flush = async () => {
    if (!operations.length) return;
    await collection.bulkWrite(operations, { ordered: false });
    operations = [];
  };

  for (;;) {
    const user = await cursor.next();
    if (!user) break;

    const set = buildSet(user);
    if (set) {
      operations.push({ updateOne: { filter: { _id: user._id }, update: { $set: set } } });
      manifest.push({ _id: String(user._id), phone: user.phone, set });
    }
    processed += 1;

    if (operations.length >= REPORT_EVERY) {
      await flush();
      logger.info(`Processed ${processed} user documents...`);
    }
  }

  await flush();

  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  const manifestPath = path.join(MANIFEST_DIR, 'user-field-backfill-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      { appliedAt: new Date().toISOString(), documentsUpdated: manifest.length, documents: manifest },
      null,
      2
    )
  );

  const after = await countMissing(collection);
  logger.info('Missing-field counts AFTER backfill', after);
  logger.info(`Backfill complete. ${manifest.length} documents updated.`);
  logger.info(`Rollback manifest written to ${manifestPath}`);

  await disconnectDatabase();
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Backfill failed', err);
    process.exit(1);
  });
