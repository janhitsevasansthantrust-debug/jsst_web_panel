/**
 * Create the FIRST owner — the account that has no way to sign in yet.
 *
 * Run it from the project root:
 *
 *   npm run create-owner -- --email you@example.com --password "StrongPass123" \
 *                           --name "आपका नाम" --trust "श्री ... ट्रस्ट"
 *
 * What it does, in order:
 *   1. creates (or updates) the Firebase Auth account
 *   2. creates the trust, its first program, the counters and the two index
 *      documents
 *   3. writes the owner custom claims onto that account
 *
 * Why a script and not a web page: at this point nobody can sign in, so there
 * is no session to authorise against. Running on your own machine, with the
 * service-account key that is already in `.env.local`, means the credential
 * never crosses the network and no public endpoint can ever create an owner.
 *
 * `npm run create-owner` loads `.env.local` via Node's own `--env-file`, so
 * there is nothing extra to install.
 */

import { parseArgs } from 'node:util';

import { adminAuth, db } from '../src/server/firebase/admin.js';
import { createTrust, countTrusts } from '../src/server/domain/bootstrap.js';
import { ROLE } from '../src/config/constants.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string', default: '' },
    trust: { type: 'string' },
    'trust-en': { type: 'string', default: '' },
    program: { type: 'string', default: 'मुख्य योजना' },
    'pay-amount': { type: 'string', default: '200' },
    'join-fees': { type: 'string', default: '0' },
    prefix: { type: 'string', default: 'RSD' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

const USAGE = `
Create the first owner account and its trust.

  npm run create-owner -- --email <email> --password <password> --trust "<name>"

Required
  --email       login email for the owner
  --password    at least 6 characters (Firebase minimum)
  --trust       trust name in Hindi

Optional
  --name        person's display name
  --trust-en    trust name in English
  --program     first program name           (default: मुख्य योजना)
  --pay-amount  contribution per closing     (default: 200)
  --join-fees   joining fee                  (default: 0)
  --prefix      receipt number prefix        (default: RSD)
  --force       create another trust even if one already exists
`;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function main() {
  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (!values.email) fail(`--email is required\n${USAGE}`);
  if (!values.password) fail('--password is required');
  if (values.password.length < 6) {
    fail('Firebase requires a password of at least 6 characters');
  }
  if (!values.trust) fail('--trust is required');

  const payAmount = Number(values['pay-amount']);
  const joinFees = Number(values['join-fees']);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    fail('--pay-amount must be a positive number');
  }
  if (!Number.isFinite(joinFees) || joinFees < 0) {
    fail('--join-fees must be zero or more');
  }

  console.log(`\nProject : ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Owner   : ${values.email}`);
  console.log(`Trust   : ${values.trust}\n`);

  /* ── Guard: do not silently create a second trust ─────────────────────── */

  const existing = await countTrusts();
  if (existing > 0 && !values.force) {
    fail(
      `${existing} trust(s) already exist in this Firebase project.\n` +
      '  If you meant to add another, re-run with --force.\n' +
      '  If you meant to sign in to the existing one, just use the login page.',
    );
  }

  /* ── 1. The Firebase Auth account ─────────────────────────────────────── */

  let user;
  try {
    user = await adminAuth.getUserByEmail(values.email);
    console.log(`• Auth account already exists (${user.uid}) — updating password`);
    user = await adminAuth.updateUser(user.uid, {
      password: values.password,
      ...(values.name ? { displayName: values.name } : {}),
      emailVerified: true,
    });
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await adminAuth.createUser({
      email: values.email,
      password: values.password,
      displayName: values.name || values.email.split('@')[0],
      emailVerified: true,
    });
    console.log(`• Created Auth account (${user.uid})`);
  }

  const claims = user.customClaims ?? {};
  if (claims.trustId && !values.force) {
    fail(
      `This account is already the ${claims.role ?? 'member'} of trust ` +
      `${claims.trustId}. Use --force to attach it to a new one.`,
    );
  }

  /* ── 2. The trust ─────────────────────────────────────────────────────── */

  const { trustId, programId } = await createTrust({
    uid: user.uid,
    email: values.email,
    name: values.name || user.displayName || '',
    input: {
      trustName: values.trust,
      trustNameEn: values['trust-en'],
      programName: values.program,
      payAmount,
      joinFees,
      receiptPrefix: values.prefix,
    },
  });

  console.log(`• Created trust    ${trustId}`);
  console.log(`• Created program  ${programId}`);
  console.log('• Created counters, closings index and member search shard');

  /* ── 3. Owner claims ──────────────────────────────────────────────────── */

  await adminAuth.setCustomUserClaims(user.uid, {
    role: ROLE.OWNER,
    trustId,
    programId,
    agentId: null,
    memberId: null,
    permissions: [],
  });
  console.log('• Wrote owner claims');

  // Force any existing session to pick up the new claims on next refresh.
  await adminAuth.revokeRefreshTokens(user.uid);

  console.log(`
✓ Done.

  Sign in at  http://localhost:3000/login
  Email       ${values.email}
  Password    (the one you just passed)

  You do NOT need the /setup page — this account is already the owner.
  Remove SETUP_SECRET from .env.local so nobody else can create a trust.
`);

  await db.terminate();
}

main().catch((error) => {
  console.error('\n✗ Failed:', error.message);
  if (error.code) console.error('  code:', error.code);
  process.exit(1);
});
