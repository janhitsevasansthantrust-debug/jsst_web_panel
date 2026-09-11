/**
 * Deploy Firebase rules and indexes, with the project taken from .env.local.
 *
 *   npm run deploy:indexes
 *   npm run deploy:storage
 *   npm run deploy:rules
 *   npm run deploy:all
 *
 * Why a wrapper instead of calling `firebase deploy` directly: the CLI has its
 * own notion of a "currently active project", stored in `.firebaserc`, which is
 * gitignored and does not exist on a fresh clone. Without it every command
 * fails with "No currently active project" — which says nothing about the fact
 * that the project id is sitting right there in `.env.local`.
 *
 * So this reads FIREBASE_PROJECT_ID, writes `.firebaserc` if it is missing,
 * and passes `--project` explicitly. One less piece of hidden state.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TARGETS = {
  indexes: 'firestore:indexes',
  storage: 'storage',
  rules: 'firestore:rules',
  all: 'firestore:indexes,storage,firestore:rules',
};

const which = process.argv[2];
const only = TARGETS[which];

if (!only) {
  console.error(
    `\nUsage: node scripts/deploy.js <${Object.keys(TARGETS).join('|')}>\n`,
  );
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('\n✗ FIREBASE_PROJECT_ID is not set in .env.local\n');
  process.exit(1);
}

// The id goes into a shell command below (Windows needs shell:true for .cmd
// files), so make sure it is only what a Firebase project id can be.
if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId)) {
  console.error(`\n✗ "${projectId}" is not a valid Firebase project id\n`);
  process.exit(1);
}

// Write .firebaserc so the plain `firebase` CLI works too, not just this script.
if (!fs.existsSync('.firebaserc')) {
  fs.writeFileSync(
    '.firebaserc',
    `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`,
  );
  console.log(`Wrote .firebaserc → ${projectId}`);
}

if (which === 'rules' || which === 'all') {
  const backups = fs.existsSync('firebase-rules-backup')
    ? fs.readdirSync('firebase-rules-backup')
    : [];

  if (!backups.length) {
    console.error(`
✗ No rules backup found.

  Deploying rules REPLACES what is live. The old app reads Firestore from the
  browser under \`users/**\` in THIS SAME project (${projectId}), so replacing
  the rules without a copy of them can lock its users out.

  Do one of these first:

    npm run rules:fetch          download the live rules automatically

  or, if that fails, open Firebase console → Firestore → Rules, copy what is
  there, and save it as:

    firebase-rules-backup/manual.rules

  Then merge anything protecting \`users/**\` into the LEGACY block at the
  bottom of firestore.rules, and run this again.
`);
    process.exit(1);
  }

  console.log(`Found ${backups.length} rules backup(s) — proceeding.`);
}

console.log(`\nDeploying "${only}" to ${projectId}…\n`);

/**
 * On Windows the Firebase CLI is `firebase.cmd`, and since Node 18.20.2 /
 * 20.12.2, spawning a `.cmd` or `.bat` WITHOUT `shell: true` is refused
 * outright (the fix for CVE-2024-27980). The refusal arrives as
 * `result.error` with code EINVAL — not ENOENT — so a script that only checks
 * for ENOENT prints nothing at all and exits silently, which looks exactly
 * like a deploy that ran and did nothing.
 *
 * That is what happened here. Hence `shell: true` on Windows, and hence the
 * error handling below reports EVERY failure mode rather than one of them.
 */
const isWindows = process.platform === 'win32';

const result = spawnSync(
  'firebase',
  ['deploy', '--only', only, '--project', projectId],
  { stdio: 'inherit', shell: isWindows },
);

if (result.error) {
  const { code, message } = result.error;

  if (code === 'ENOENT') {
    console.error(
      '\n✗ The Firebase CLI was not found.\n\n' +
      '    npm install -g firebase-tools\n' +
      '    firebase login\n',
    );
  } else {
    console.error(`\n✗ Could not run the Firebase CLI (${code ?? 'unknown'}): ${message}\n`);
  }
  process.exit(1);
}

if (result.status === 0) {
  console.log(`\n✓ Deployed "${only}" to ${projectId}\n`);

  if (which === 'indexes' || which === 'all') {
    console.log(
      '  Indexes build in the background. Until they are green, a query that\n' +
      '  needs one fails with FAILED_PRECONDITION. Watch progress at:\n' +
      `  https://console.firebase.google.com/project/${projectId}/firestore/indexes\n`,
    );
  }
} else {
  console.error(
    `\n✗ Firebase exited with code ${result.status}. ` +
    'The CLI output above says why.\n',
  );
  console.error('  Common causes:\n');
  console.error('  • "authentication"        → firebase login');
  console.error(
    '  • "index already exists"  → that index is already in the project.\n' +
    '      Either it was created from a console link, or two entries in\n' +
    '      firestore.indexes.json describe the SAME index. Firestore appends\n' +
    '      `__name__` to every composite index itself, so listing it makes an\n' +
    '      entry look different in the file while being identical on the\n' +
    '      server. Deploy is not atomic — earlier indexes in the run were\n' +
    '      created, so re-running after the fix is safe.',
  );
  console.error(
    '  • "FAILED_PRECONDITION"   → an index is still building; wait and retry.\n',
  );
}

process.exit(result.status ?? 1);
