/**
 * Move members out of the per-program sub-collections into the flat one.
 *
 *   npm run migrate:flatten -- --trust <trustId>          # dry run
 *   npm run migrate:flatten -- --trust <trustId> --apply  # actually write
 *
 * Old: trusts/{t}/programs/{p}/members/{m}
 * New: trusts/{t}/members/{m}          with programId: p
 *
 * Document ids are preserved, which is what makes this safe to re-run and
 * safe to interrupt: copying the same member twice writes the same document
 * twice. Nothing is deleted — the old sub-collections are left exactly where
 * they are, so if anything looks wrong the fix is to stop using the new
 * collection, not to restore a backup. Delete them yourself once you have seen
 * the members list working.
 *
 * A member whose id already exists in the flat collection is skipped rather
 * than overwritten, so a half-finished run followed by real usage cannot be
 * undone by running this again.
 */

import { db, serverNow } from '../src/server/firebase/admin.js';
import { rebuildMembersIndex } from '../src/server/domain/indexes.js';
import { paths } from '../src/config/constants.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const trustArg = argv[argv.indexOf('--trust') + 1];
const trustId = argv.includes('--trust') ? trustArg : null;

async function trustIds() {
  if (trustId) return [trustId];
  const snap = await db.collection('trusts').select().get();
  return snap.docs.map((d) => d.id);
}

let copied = 0;
let skipped = 0;
let scanned = 0;

for (const t of await trustIds()) {
  const programs = await db.collection(paths.programs(t)).select('name').get();
  console.log(`\nTrust ${t} — ${programs.size} योजना`);

  for (const program of programs.docs) {
    const p = program.id;
    const legacy = await db
      .collection(`trusts/${t}/programs/${p}/members`)
      .get();

    if (legacy.empty) {
      console.log(`  ${program.data().name ?? p}: nothing to move`);
      continue;
    }

    let programCopied = 0;
    let programSkipped = 0;

    // Batches of 400 — Firestore's limit is 500 writes, and leaving headroom
    // costs nothing.
    for (let i = 0; i < legacy.docs.length; i += 400) {
      const slice = legacy.docs.slice(i, i + 400);

      // Check the destination first. A member already in the flat collection
      // has been live there, possibly with payments against them; overwriting
      // from the old copy would roll that back.
      const existing = await db.getAll(
        ...slice.map((d) => db.doc(paths.member(t, d.id))),
      );

      const batch = db.batch();
      slice.forEach((doc, n) => {
        scanned += 1;
        if (existing[n].exists) {
          programSkipped += 1;
          skipped += 1;
          return;
        }

        batch.set(db.doc(paths.member(t, doc.id)), {
          ...doc.data(),
          // The field that replaces the path. Trust the sub-collection it was
          // found in over any programId already on the document — the path is
          // where it actually lived.
          programId: p,
          programName: program.data().name ?? '',
          migratedAt: serverNow(),
        });
        programCopied += 1;
        copied += 1;
      });

      if (apply) await batch.commit();
    }

    console.log(
      `  ${program.data().name ?? p}: ${programCopied} to copy, ${programSkipped} already there`,
    );
  }

  if (apply) {
    const result = await rebuildMembersIndex(t);
    console.log(
      `  index rebuilt: ${result.total} members → ${result.shardCount} shard(s)`,
    );
  }
}

console.log(
  `\n${apply ? '✓ Migrated' : 'DRY RUN'} — scanned ${scanned}, ` +
  `${apply ? 'copied' : 'would copy'} ${copied}, skipped ${skipped}`,
);

if (!apply) {
  console.log('\nRe-run with --apply to write. Nothing has been changed.\n');
} else {
  console.log(
    '\nThe old programs/*/members sub-collections were NOT deleted.\n' +
    'Check the members list, then remove them from the Firebase console.\n',
  );
}

process.exit(0);
