/**
 * Diagnostic: what already exists in this Firebase project?
 *
 *   npm run whoami
 *
 * Answers the questions you actually have when a login or /setup misbehaves:
 * which accounts exist, which of them carry trust claims, and which trusts are
 * already there. Read-only — it changes nothing.
 */

import { adminAuth, db } from '../src/server/firebase/admin.js';

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

async function main() {
  console.log(`\nProject: ${process.env.FIREBASE_PROJECT_ID}\n`);

  /* ── Trusts ───────────────────────────────────────────────────────────── */

  const trusts = await db.collection('trusts').limit(25).get();

  console.log(`TRUSTS (${trusts.size})`);
  if (trusts.empty) {
    console.log('  none yet — run `npm run create-owner` to make the first one');
  }
  for (const doc of trusts.docs) {
    const t = doc.data();
    console.log(`  ${doc.id}  ${t.name ?? '(unnamed)'}   owner: ${t.ownerUid ?? '—'}`);

    const programs = await doc.ref.collection('programs').get();
    for (const p of programs.docs) {
      const stats = await db
        .doc(`trusts/${doc.id}/programs/${p.id}/counters/stats`)
        .get();
      const s = stats.data() ?? {};
      console.log(
        `      program ${p.id}  ${p.data().name ?? ''}` +
        `  members=${s.members?.total ?? 0}` +
        `  closings=${s.closings?.total ?? 0}` +
        `  collected=₹${s.money?.collectedTotal ?? 0}`,
      );
    }
  }

  /* ── Auth accounts ────────────────────────────────────────────────────── */

  const { users } = await adminAuth.listUsers(1000);

  const withClaims = users.filter((u) => u.customClaims?.trustId);
  const withoutClaims = users.filter((u) => !u.customClaims?.trustId);

  console.log(`\nAUTH ACCOUNTS (${users.length} total)\n`);
  console.log(`  Linked to a trust — these can sign in (${withClaims.length}):`);
  if (!withClaims.length) console.log('    none');
  for (const u of withClaims.slice(0, 30)) {
    const c = u.customClaims ?? {};
    console.log(
      `    ${pad(u.email ?? u.uid, 40)} ${pad(c.role, 10)} trust=${c.trustId}`,
    );
  }

  console.log(
    `\n  No trust claim — these get bounced to /setup (${withoutClaims.length}):`,
  );
  for (const u of withoutClaims.slice(0, 15)) {
    console.log(`    ${pad(u.email ?? u.uid, 40)} ${u.displayName ?? ''}`);
  }
  if (withoutClaims.length > 15) {
    console.log(`    … and ${withoutClaims.length - 15} more`);
  }

  console.log(`
──────────────────────────────────────────────────────────────
No account linked to a trust?  Create the first owner:

  npm run create-owner -- --email you@example.com \\
      --password "YourStrongPass" --trust "श्री ... ट्रस्ट"

Already have an account listed above with a trust?
Just sign in with it at /login — you do not need /setup.
`);

  await db.terminate();
}

main().catch((error) => {
  console.error('\n✗ Failed:', error.message);
  if (error.code) console.error('  code:', error.code);
  process.exit(1);
});
