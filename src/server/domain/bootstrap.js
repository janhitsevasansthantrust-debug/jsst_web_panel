import { db, serverNow } from '../firebase/admin.js';
import { conflict } from '../errors.js';
import { ROLE, paths } from '../../config/constants.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * bootstrap.js — creating a trust from nothing.
 *
 * Shared by two callers, so the two paths can never drift apart:
 *
 *   • `scripts/create-owner.js` — the FIRST owner, run from the terminal.
 *     Creates the Firebase Auth account too, because at that point nobody can
 *     sign in yet.
 *   • `POST /api/setup` — a signed-in user claiming a new trust.
 *
 * Everything a trust needs to function is created here in one batch. Miss any
 * of it and the first page load fails in a confusing way: the counters
 * document is what makes the dashboard a single read, and the two index
 * documents are what make closings and search cheap.
 */

export function buildTrustDocuments({ uid, email, name, input, trustRef, programRef }) {
  const trustId = trustRef.id;
  const programId = programRef.id;

  return [
    [
      trustRef,
      {
        name: input.trustName,
        ownerUid: uid,
        branding: {
          nameHi: input.trustName,
          nameEn: input.trustNameEn ?? '',
          tagline: '',
          registrationNo: '',
          addressHi: '',
          phone: [],
          email: email ?? '',
          logoURL: '',
          sealURL: '',
          signatureURL: '',
          signatoryName: name ?? '',
          signatoryDesignation: 'अध्यक्ष',
          headerLines: [],
          footerNote: '',
          terms: [],
          theme: { primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT },
          receiptPrefix: input.receiptPrefix ?? 'RSD',
          language: 'hi',
          showQR: false,
        },
        createdAt: serverNow(),
        createdBy: uid,
      },
    ],

    [
      programRef,
      {
        name: input.programName,
        isSelected: true,
        defaultPayAmount: input.payAmount,
        defaultJoinFees: input.joinFees,
        commissionPolicy: {
          joinFee: { enabled: false, mode: 'percent', value: 0, slabs: [] },
          collection: { enabled: false, mode: 'percent', value: 0, slabs: [] },
          minPayout: 0,
          autoApprove: false,
        },
        createdAt: serverNow(),
        createdBy: uid,
      },
    ],

    // Sequence allocator. `closing` and `receipt` are incremented inside the
    // payment/closing transactions, so they must exist before the first write.
    [
      db.doc(paths.counterSeq(trustId, programId)),
      {
        closing: 0,
        receipt: 0,
        registration: 1000,
        receiptPrefix: input.receiptPrefix ?? 'RSD',
        updatedAt: serverNow(),
      },
    ],

    // The whole dashboard, in one document.
    [
      db.doc(paths.counterStats(trustId, programId)),
      {
        members: { total: 0, pending: 0, accepted: 0, closed: 0, blocked: 0, left: 0 },
        closings: { total: 0, active: 0, reverted: 0, maxSeq: 0 },
        money: {
          collectedTotal: 0,
          expectedTotal: 0,
          dueTotal: 0,
          joinFeesTotal: 0,
          creditTotal: 0,
        },
        receipts: { total: 0, cancelled: 0 },
        commission: { earnedTotal: 0, paidTotal: 0, dueTotal: 0 },
        updatedAt: serverNow(),
      },
    ],

    // The shared closings index — one read serves every screen.
    [
      db.doc(paths.closingsIndex(trustId, programId)),
      { items: [], maxSeq: 0, count: 0, version: Date.now(), updatedAt: serverNow() },
    ],

    // Member search shard 0 — trust-wide, covering every योजना.
    [
      db.doc(paths.membersIndexShard(trustId, 0)),
      {
        items: [],
        shard: 0,
        shardCount: 1,
        count: 0,
        version: Date.now(),
        updatedAt: serverNow(),
      },
    ],

    [
      db.doc(paths.user(trustId, uid)),
      {
        uid,
        email: email ?? null,
        name: name ?? '',
        role: ROLE.OWNER,
        active: true,
        createdAt: serverNow(),
      },
    ],
  ];
}

/**
 * Create a trust, its first program, and all supporting documents.
 * Returns `{ trustId, programId }`. Does NOT set custom claims — the caller
 * does that, because the two callers refresh tokens differently.
 */
export async function createTrust({ uid, email, name, input }) {
  // With TRUST_ID set, the trust document has a known id rather than a random
  // one — so a fresh deployment pointed at an existing Firebase project finds
  // the same trust instead of quietly creating a second, empty one beside it.
  const pinned = (process.env.TRUST_ID ?? '').trim();

  if (pinned) {
    const existing = await db.doc(`trusts/${pinned}`).get();
    if (existing.exists) {
      throw conflict(
        'यह ट्रस्ट पहले से मौजूद है। यह सिस्टम एक ही ट्रस्ट के लिए है — ' +
        'दूसरे ट्रस्ट के लिए अलग deployment बनाएँ।',
        { trustId: pinned },
      );
    }
  }

  const trustRef = pinned
    ? db.doc(`trusts/${pinned}`)
    : db.collection('trusts').doc();
  const programRef = trustRef.collection('programs').doc();

  const writes = buildTrustDocuments({
    uid, email, name, input, trustRef, programRef,
  });

  const batch = db.batch();
  for (const [ref, data] of writes) batch.set(ref, data);
  await batch.commit();

  return { trustId: trustRef.id, programId: programRef.id };
}

/** How many trusts already exist — used to warn before creating a second one. */
export async function countTrusts() {
  const snap = await db.collection('trusts').count().get();
  return snap.data().count;
}
