/**
 * Write `searchKeywords` onto every member that has none.
 *
 *   npm run backfill:keywords -- --trust <trustId>
 *   npm run backfill:keywords -- --trust <trustId> --all
 *
 * Members created before the field existed do not have it, and nothing writes
 * it to them until somebody happens to edit that member — so a search by आधार
 * number would find the people enrolled this week and silently miss everyone
 * enrolled before. A field that works for some rows and not others is worse
 * than one that works for none, because nobody knows which answer to trust.
 *
 * `--all` recomputes for every member rather than only the ones missing it —
 * use it after changing what `memberKeywords` puts in the list.
 *
 * Safe to re-run. It writes one field and touches nothing else: no counters,
 * no ledger, no `updatedAt` (an operator should not see "edited just now" on
 * five thousand members because of a maintenance script).
 */

import { memberKeywords } from '../src/lib/memberSearch.js';
import { db } from '../src/server/firebase/admin.js';
import { paths } from '../src/config/constants.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.replace(/^--/, '');
  const next = process.argv[i + 1];
  args.set(key, next && !next.startsWith('--') ? next : true);
}

const trustArg = args.get('trust');
const rewriteAll = args.get('all') === true;

/** 400 is Firestore's write limit per batch; 300 leaves room to be wrong. */
const BATCH = 300;

async function trustIds() {
  if (typeof trustArg === 'string') return [trustArg];
  const snap = await db.collection('trusts').select().get();
  return snap.docs.map((d) => d.id);
}

const ids = await trustIds();

if (!ids.length) {
  console.error('\n✗ No trusts found. Pass one explicitly: --trust <trustId>\n');
  process.exit(1);
}

for (const trustId of ids) {
  const snap = await db.collection(paths.members(trustId)).get();

  let written = 0;
  let skipped = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const member = doc.data();

    if (!rewriteAll && Array.isArray(member.searchKeywords) && member.searchKeywords.length) {
      skipped += 1;
      continue;
    }

    batch.update(doc.ref, { searchKeywords: memberKeywords(member) });
    pending += 1;
    written += 1;

    if (pending >= BATCH) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
      process.stdout.write(`\r  ${trustId}: ${written} written…`);
    }
  }

  if (pending) await batch.commit();

  console.log(
    `\r  ${trustId}: ${written} written, ${skipped} already had keywords ` +
    `(${snap.size} members).`,
  );
}

console.log('\nDone.\n');
process.exit(0);
