/**
 * Bring the old app's agents and members across.
 *
 *   npm run migrate -- --uid <oldAdminUid> --program <oldProgramId> --to <newProgramId>
 *   npm run migrate -- ... --apply            actually write
 *   npm run migrate -- --list                 show what is over there, then stop
 *
 * ─── What this does and does not do ──────────────────────────────────────
 *
 * It copies AGENTS and MEMBERS. It does NOT copy closings or payment history,
 * and that is a deliberate line rather than an omission.
 *
 * In the old system every member carried a pile of `payment_pending` rows —
 * one per member per closing — and what somebody owed was whatever those rows
 * happened to say. In this system nothing is stored: dues are DERIVED from the
 * closings that exist and each member's own joining date. There is no way to
 * import the old rows into that model without inventing closings to hang them
 * on, and an invented closing bills five thousand people.
 *
 * So the honest split is: members and their identity come across; the old
 * ledger stays in the old system as the historical record; this system starts
 * billing from its own first closing. Every imported member's `joinDateMs` is
 * preserved, so when a closing IS made here, exactly the right people owe it.
 *
 * ─── Safe to run twice ───────────────────────────────────────────────────
 *
 * Keyed on the old document id, so a member imported once is updated rather
 * than duplicated. Run it, look at the numbers, run it again.
 */

import { createRequire } from 'node:module';

import { db, serverNow } from '../src/server/firebase/admin.js';
import { paths, MEMBER_STATUS, EXIT_REASON, ROLE, LIMITS } from '../src/config/constants.js';
import { memberKeywords } from '../src/lib/memberSearch.js';
import { resolveTrustId } from '../src/server/domain/trustId.js';
import { rebuildMembersIndex } from '../src/server/domain/indexes.js';

const require = createRequire(import.meta.url);
const { cert, initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/* ── arguments ──────────────────────────────────────────────────────────── */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  args.set(a.slice(2), next && !next.startsWith('--') ? next : true);
}

const APPLY = args.get('apply') === true;
const LIST = args.get('list') === true;
const OLD_UID = args.get('uid');
const OLD_PROGRAM = args.get('program');
const NEW_PROGRAM = args.get('to');

/* ── the old project ────────────────────────────────────────────────────── */

function oldDb() {
  for (const name of ['OLD_FIREBASE_PROJECT_ID', 'OLD_FIREBASE_CLIENT_EMAIL', 'OLD_FIREBASE_PRIVATE_KEY']) {
    if (!process.env[name]) {
      die(
        `${name} is not set in .env.local.\n\n` +
        '  Open the OLD Firebase project → Project settings → Service accounts →\n' +
        '  Generate new private key, then put its three values in .env.local as\n' +
        '  OLD_FIREBASE_PROJECT_ID, OLD_FIREBASE_CLIENT_EMAIL and OLD_FIREBASE_PRIVATE_KEY.',
      );
    }
  }

  const app =
    getApps().find((a) => a.name === 'old') ??
    initializeApp(
      {
        credential: cert({
          projectId: process.env.OLD_FIREBASE_PROJECT_ID,
          clientEmail: process.env.OLD_FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.OLD_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      },
      'old',
    );

  return getFirestore(app);
}

/* ── field mapping ──────────────────────────────────────────────────────── */

/** `DD-MM-YYYY` — what the old app stored everywhere — to epoch ms. */
function parseDMY(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // The agent records used YYYY-MM-DD, and a few rows carry a Firestore
  // Timestamp or an ISO string. Take whatever parses rather than dropping a
  // joining date — that date decides what the member owes.
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function mapAgent(id, a, trustId, newProgramId) {
  return {
    uid: a.uid ?? id,
    displayName: a.displayName ?? '',
    email: a.email ?? '',
    phone: a.phone ?? '',

    dateJoin: a.dateJoin ?? '',
    dateJoinMs: parseDMY(a.dateJoin) ?? Date.now(),

    address: a.address ?? '',
    city: a.city ?? '',
    village: a.village ?? '',
    state: a.state ?? '',
    district: a.district ?? '',
    pinCode: a.pinCode ?? '',

    photoURL: a.photoURL ?? '',
    signatureURL: a.signatureURL ?? '',
    documentURLs: a.documentURLs ?? [],

    commissionOverride: null,

    // Recomputed by the member pass below, not carried over: the old counter
    // had drifted on several agents and a wrong count here is a wrong
    // commission slab later.
    memberCount: 0,
    collectionCount: 0,
    collectedAmount: 0,
    earnedTotal: 0,
    paidTotal: 0,
    dueTotal: 0,

    role: ROLE.AGENT,
    status: a.status ?? 'active',
    // The old app spelled these `active_flags` / `delete_flags`, plural.
    active: a.active_flags !== false && a.delete_flags !== true,
    delete_flag: a.delete_flags === true,

    trustId,
    programId: newProgramId,
    migratedFrom: id,
    createdAt: serverNow(),
    updatedAt: serverNow(),
  };
}

function mapMember(id, m, { trustId, newProgramId, programName, agentMap }) {
  const joinDateMs = parseDMY(m.dateJoin) ?? Date.now();
  const bobDateMs = parseDMY(m.bobDate);

  /**
   * The member's own agent, translated to the new id.
   *
   * An agent who was never migrated leaves this null rather than pointing at
   * something that does not exist — a dangling agentId shows as a blank column
   * everywhere and breaks the agent filter silently.
   */
  const agentId = m.agentId ? (agentMap.get(m.agentId) ?? null) : null;

  const closed = m.marriage_flag === true || m.status === 'closed';
  const closingDateMs = parseDMY(m.closing_date ?? m.marriage_date);

  const base = {
    registrationNumber: String(m.registrationNumber ?? ''),

    displayName: m.displayName ?? '',
    fatherName: m.fatherName ?? '',
    jati: m.jati ?? '',
    gotra: m.gotra ?? '',
    guardian: m.guardian ?? '',
    guardianRelation: m.guardianRelation ?? '',
    gender: m.gender ?? '',

    phone: String(m.phone ?? m.phoneNo ?? ''),
    phoneAlt: String(m.phoneAlt ?? ''),
    aadhaarNo: String(m.aadhaarNo ?? '').replace(/\D+/g, ''),

    bobDate: m.bobDate ?? '',
    bobDateMs,
    joinDate: m.dateJoin ?? '',
    joinDateMs,

    state: m.state ?? '',
    district: m.district ?? '',
    village: m.village ?? '',
    pinCode: String(m.pinCode ?? ''),
    currentAddress: m.currentAddress ?? '',

    photoURL: m.photoURL ?? '',
    extraImageURL: m.extraImageURL ?? '',
    documentFrontURL: m.documentFrontURL ?? '',
    documentBackURL: m.documentBackURL ?? '',
    guardianDocumentURL: m.guardianDocumentURL ?? '',
    extraDetails: Array.isArray(m.extraDetails)
      ? m.extraDetails.filter((f) => f?.label && f?.value)
      : [],

    /**
     * Rates are CARRIED OVER, not recomputed from the new programme's bands.
     *
     * Recomputing would be defensible and is the wrong call: these people have
     * been paying a particular amount for years, and a migration that quietly
     * reprices five thousand members because a band boundary was typed
     * slightly differently in the new programme is a migration nobody can
     * unpick afterwards. What they paid is what they pay; a band can be
     * corrected member by member afterwards, visibly.
     */
    ageGroup: m.ageGroup ?? null,
    ageGroupRange: m.ageGroupRange ?? '',
    age: m.age ?? null,
    payAmount: Number(m.payAmount) || LIMITS.DEFAULT_PAY_AMOUNT,
    joinFees: Number(m.joinFees) || 0,
    locactionGroupId: m.locactionGroupId ?? null,
    locationGroup: m.locationGroup ?? '',
    memberGroup: m.memberGroup ?? '',
    groupType: m.groupType ?? '',

    joinFeesDone: Boolean(m.joinFeesDone),
    joinFeesTxtId: m.joinFeesTxtId ?? '',
    joinFeesReceiptId: null,

    addedBy: agentId ? 'agent' : 'admin',
    addedByName: m.addedByName ?? (agentId ? '' : 'Admin'),
    agentId,
    agentName: agentId ? (m.addedByName ?? '') : '',

    status: closed ? MEMBER_STATUS.CLOSED : (m.status ?? MEMBER_STATUS.ACCEPTED),
    programId: newProgramId,
    programName,

    /**
     * A closed member keeps their exit date, because that is what stops them
     * being billed for closings made here after they left.
     */
    closingId: null,
    closingSeq: null,
    closingDateMs: closed ? closingDateMs : null,
    exitDateMs: closed ? closingDateMs : null,
    exitReason: closed ? EXIT_REASON.CLOSED : null,
    exitDate: closed ? (m.closing_date ?? '') : null,
    creditBalance: 0,

    /**
     * A clean ledger. See the note at the top: the old `payment_pending` rows
     * cannot be mapped onto closings that do not exist here, and the first
     * closing made in this system is the first thing anybody owes in it.
     */
    paidUpTo: 0,
    paidSeqs: [],
    exemptSeqs: [],
    partialPaid: {},
    paidCount: 0,
    paidAmount: 0,
    dueCount: 0,
    dueAmount: 0,
    lastPaymentAt: null,

    role: 'member',
    active_flag: m.active_flag !== false,
    delete_flag: m.delete_flag === true,

    trustId,
    migratedFrom: id,
    createdAt: serverNow(),
    updatedAt: serverNow(),
  };

  return { ...base, searchKeywords: memberKeywords(base) };
}

/* ── run ────────────────────────────────────────────────────────────────── */

const old = oldDb();

/**
 * Said before the first network call, not after.
 *
 * Every line below this one waits on Firestore, and a machine behind a proxy
 * that blocks it does not error — it hangs, silently, forever. A script that
 * prints nothing looks broken; one that has said what it is waiting for is
 * merely slow.
 */
console.log(`\nReading ${process.env.OLD_FIREBASE_PROJECT_ID}…`);

if (LIST || !OLD_UID) {
  await listWhatIsThere();
  process.exit(0);
}

if (!OLD_PROGRAM || !NEW_PROGRAM) {
  die('Both --program <oldProgramId> and --to <newProgramId> are required. Run --list to see the ids.');
}

const trustId = await resolveTrustId();
const newProgramSnap = await db.doc(paths.program(trustId, NEW_PROGRAM)).get();
if (!newProgramSnap.exists) die(`No programme ${NEW_PROGRAM} in this trust. Run --list.`);
const programName = newProgramSnap.data().name ?? '';

console.log(`\n${APPLY ? 'MIGRATING' : 'DRY RUN'} — old ${OLD_PROGRAM} → ${programName} (${NEW_PROGRAM})\n`);

/* ── read both sides before writing anything ────────────────────────────── */

const agentSnap = await old.collection(`users/${OLD_UID}/agents`).get();
const memberSnap = await old
  .collection(`users/${OLD_UID}/programs/${OLD_PROGRAM}/members`)
  .get();

/**
 * An empty read is a wrong id, not an empty trust.
 *
 * The first version of this printed `0 found` and then `Done.`, and rebuilt
 * the search index on the way out — which reads exactly like a migration that
 * worked against a trust that happened to have nobody in it. Nobody runs a
 * migration for nought members, so treat it as the typo it is, refuse to go
 * on, and print what the ids actually are.
 */
if (!memberSnap.size) {
  const why = agentSnap.size
    ? `users/${OLD_UID} has ${agentSnap.size} agents, but programme ${OLD_PROGRAM} has no\n  members under it — so --uid is right and --program is wrong.`
    : `users/${OLD_UID} has neither agents nor members — --uid itself is wrong.`;

  console.error(`\n\u2717 Nothing to migrate, so nothing was written.\n\n  ${why}\n`);
  console.error('  What is actually over there:');
  await listWhatIsThere();
  process.exit(1);
}

/* agents first, so members can point at them */

const agentMap = new Map();
let agentsWritten = 0;

for (const doc of agentSnap.docs) {
  const mapped = mapAgent(doc.id, doc.data(), trustId, NEW_PROGRAM);

  // The agent keeps their old document id, which is their Auth uid in both
  // systems — so a migrated agent can sign in with the password they already
  // have, and every member's `agentId` still resolves.
  agentMap.set(doc.id, doc.id);

  if (APPLY) {
    await db.doc(paths.agent(trustId, doc.id)).set(mapped, { merge: true });
    agentsWritten += 1;
  }
}

console.log(`  agents   ${agentSnap.size} found${APPLY ? `, ${agentsWritten} written` : ''}`);

/* then members */

const counts = { total: memberSnap.size, written: 0, closed: 0, noReg: 0, noJoinDate: 0, noAgent: 0 };
const perAgent = new Map();

let batch = db.batch();
let pending = 0;

for (const doc of memberSnap.docs) {
  const m = doc.data();
  const mapped = mapMember(doc.id, m, { trustId, newProgramId: NEW_PROGRAM, programName, agentMap });

  if (!mapped.registrationNumber) counts.noReg += 1;
  if (!parseDMY(m.dateJoin)) counts.noJoinDate += 1;
  if (m.agentId && !agentMap.has(m.agentId)) counts.noAgent += 1;
  if (mapped.status === MEMBER_STATUS.CLOSED) counts.closed += 1;
  if (mapped.agentId) perAgent.set(mapped.agentId, (perAgent.get(mapped.agentId) ?? 0) + 1);

  if (APPLY) {
    // The old document id is kept, so re-running updates rather than
    // duplicating — and so a member can still be traced back.
    batch.set(db.doc(paths.member(trustId, doc.id)), mapped, { merge: true });
    pending += 1;
    counts.written += 1;

    if (pending >= 300) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
      process.stdout.write(`\r  members  ${counts.written} written…`);
    }
  }
}

if (APPLY && pending) await batch.commit();

console.log(`\r  members  ${counts.total} found${APPLY ? `, ${counts.written} written` : ''}`);
console.log(`           ${counts.closed} already closed`);
if (counts.noReg) console.log(`  ⚠ ${counts.noReg} have NO registration number`);
if (counts.noJoinDate) console.log(`  ⚠ ${counts.noJoinDate} have no readable joining date — dated today`);
if (counts.noAgent) console.log(`  ⚠ ${counts.noAgent} point at an agent that was not migrated — left unassigned`);

if (APPLY) {
  for (const [agentId, n] of perAgent) {
    await db.doc(paths.agent(trustId, agentId)).set({ memberCount: n }, { merge: true });
  }

  process.stdout.write('\n  rebuilding the search index… ');
  const result = await rebuildMembersIndex(trustId);
  console.log(`${result.total} entries in ${result.shardCount} shard(s)`);
}

console.log(
  APPLY
    ? '\nDone. Dues start from this system’s first closing — the old ledger stays where it is.\n'
    : '\nNothing was written. Add --apply to do it for real.\n',
);

process.exit(0);

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * Every uid and programme id on the old side, with counts.
 *
 * `listDocuments()` rather than `get()`, and that is the whole point of this
 * function: a Firestore document that holds only subcollections has no fields
 * of its own, and such a document does NOT come back from reading its
 * collection. `users/{uid}` is very often exactly that — the old app wrote to
 * `users/{uid}/members` and `users/{uid}/agents` and frequently never wrote a
 * single field to `users/{uid}` itself — so a plain `get()` here can report an
 * empty project that in fact holds every member the trust has.
 */
async function listWhatIsThere() {
  console.log('\nOLD project:', process.env.OLD_FIREBASE_PROJECT_ID);

  const users = await old.collection('users').listDocuments();
  if (!users.length) {
    console.log('  (no `users` collection at all — is this service account for the right project?)');
  }

  for (const uref of users) {
    const d = (await uref.get()).data() ?? {};
    const agents = await old.collection(`users/${uref.id}/agents`).count().get();
    const programs = await old.collection(`users/${uref.id}/programs`).listDocuments();

    console.log(
      `\n  --uid ${uref.id}   ${d.displayName ?? ''} ${d.email ?? ''}` +
        `   (${agents.data().count} agents)`,
    );

    if (!programs.length) console.log('    (no programmes under this uid)');

    for (const pref of programs) {
      const p = (await pref.get()).data() ?? {};
      const n = await old
        .collection(`users/${uref.id}/programs/${pref.id}/members`)
        .count()
        .get();
      console.log(`    --program ${pref.id}   ${p.name ?? ''}   (${n.data().count} members)`);
    }
  }

  console.log('\nNEW project — programmes to import INTO:');
  const into = await resolveTrustId();
  const mine = await db.collection(paths.programs(into)).select('name').get();
  for (const p of mine.docs) {
    console.log(`    --to ${p.id}   ${p.data().name ?? ''}`);
  }
  console.log('');
}

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
