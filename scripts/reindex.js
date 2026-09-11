/**
 * Rebuild the member search index for a trust.
 *
 *   npm run reindex -- --trust <trustId>
 *
 * Every list, filter, total and search in the app is served from this index,
 * so it is the one thing worth being able to rebuild on demand. It is safe to
 * run at any time: it reads the members collection and overwrites the shards,
 * so the worst case of running it needlessly is one read per member.
 *
 * Run it after a migration, after a bulk import, or any time the counters on
 * screen look out of step with reality.
 */

import { rebuildMembersIndex } from '../src/server/domain/indexes.js';
import { db } from '../src/server/firebase/admin.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const trustId = args.get('trust');

async function trustIds() {
  if (trustId) return [trustId];
  const snap = await db.collection('trusts').select().get();
  return snap.docs.map((d) => d.id);
}

const ids = await trustIds();

if (!ids.length) {
  console.error('\n✗ No trusts found. Pass one explicitly: --trust <trustId>\n');
  process.exit(1);
}

for (const id of ids) {
  process.stdout.write(`Rebuilding member index for ${id}… `);
  const result = await rebuildMembersIndex(id);
  console.log(
    `${result.total} members → ${result.shardCount} shard(s)` +
    `  (${result.shardCount} reads per search)`,
  );
}

console.log('\n✓ Done\n');
process.exit(0);
