/**
 * The closing lifecycle, end to end, against the Firestore emulator.
 *
 * Usage:
 *   firebase emulators:start --only firestore --project demo-trust
 *   npm run verify:closings
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * `npm test` proves the pure rules. It cannot prove the TRANSACTIONS, and the
 * transactions are where the closing system lives: one create, several
 * payments, a cancellation, a revert and a re-create, each of which writes to
 * the member ledger, the closing counters, the trust's stats, the agent's
 * commission and the shared index at the same time. Every one of those has been
 * wrong at some point in a way no unit test could see.
 *
 * It asserts on the DOCUMENTS, not on return values, because a function that
 * reports the right answer while writing the wrong one is the actual bug class.
 *
 * The credentials in `.env.local` are never used — FIRESTORE_EMULATOR_HOST
 * makes the SDK talk to the emulator and ignore them.
 */

import assert from 'node:assert/strict';

import { db, serverNow } from '../src/server/firebase/admin.js';
import { paths, MEMBER_STATUS, PAYMENT_STATUS, COMMISSION_TYPE } from '../src/config/constants.js';
import { createClosing, revertClosing, listClosings, getClosingCollection } from '../src/server/domain/closings.js';
import { createBatch, setClosingBatch } from '../src/server/domain/closingBatches.js';
import { postPayment, cancelPayment, bulkCollect } from '../src/server/domain/payments.js';
import { createPayout } from '../src/server/domain/agents.js';
import { getMembersIndex, getClosingsIndex, rebuildMembersIndex } from '../src/server/domain/indexes.js';
import { collectionReport } from '../src/server/domain/collectionReport.js';
import { computeDue } from '../src/server/domain/ledger.js';
import { summariseEntries, netAmount, round2 } from '../src/server/domain/commission.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'This only runs against the emulator. Start it first:\n' +
    '  firebase emulators:start --only firestore --project demo-trust',
  );
}

const TRUST = 'verify-trust';
const PROGRAM = 'verify-program';
const AGENT = 'a1';

const ADMIN = { trustId: TRUST, programId: PROGRAM, uid: 'u-admin', role: 'owner' };
const AGENT_SCOPE = { trustId: TRUST, programId: PROGRAM, uid: 'u-agent', role: 'agent', agentId: AGENT };

const day = (d, month = 3) => Date.UTC(2026, month, d);
const money = (n) => Math.round(n * 100) / 100;

let checks = 0;
async function check(label, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    console.error(`  FAIL ${label}\n       ${error.message}`);
    throw error;
  }
}

async function member(id, over = {}) {
  const ref = db.doc(paths.member(TRUST, id));
  await ref.set({
    programId: PROGRAM,
    registrationNumber: `V${100000 + Math.floor(Math.random() * 8999)}`,
    displayName: id,
    fatherName: 'पिता',
    phone: '9000000000',
    village: 'गाँव',
    district: 'जिला',
    status: MEMBER_STATUS.ACCEPTED,
    agentId: AGENT,
    agentName: 'एजेंट',
    ageGroupRange: '23-45',
    payAmount: 200,
    joinDateMs: day(1, 0),
    joinFees: 0,
    joinFeesDone: true,
    paidUpTo: 0,
    paidSeqs: [],
    exemptSeqs: [],
    partialPaid: {},
    dueCount: 0,
    dueAmount: 0,
    paidCount: 0,
    paidAmount: 0,
    delete_flag: false,
    createdAt: serverNow(),
    ...over,
  });
  return ref;
}

const readMember = async (id) => ({ id, ...(await db.doc(paths.member(TRUST, id)).get()).data() });
const readClosing = async (id) => ({ id, ...(await db.doc(paths.closing(TRUST, PROGRAM, id)).get()).data() });
const readStats = async () => (await db.doc(paths.counterStats(TRUST, PROGRAM)).get()).data() ?? {};
const readAgent = async () => (await db.doc(paths.agent(TRUST, AGENT)).get()).data() ?? {};
const readIndex = async () => (await getClosingsIndex(TRUST, PROGRAM, { fresh: true })).items;
const payments = async (memberId) => {
  const snap = await db.collection(paths.payments(TRUST, PROGRAM)).where('memberId', '==', memberId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};
const commissionEntries = async () => {
  const snap = await db.collection(paths.commissionEntries(TRUST, PROGRAM)).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/* ══════════════════════════════════════════════════════════════════════════ */

console.log('\nक्लोजिंग जीवनचक्र — end to end against the emulator\n');

/**
 * The emulator keeps everything between runs, and this script is only allowed to
 * write under its own trust — so it wipes that trust first. Anything left over
 * from a previous run would show up as extra closings and fail a check that is
 * actually correct.
 */
if (typeof db.recursiveDelete === 'function') {
  await db.recursiveDelete(db.doc(paths.trust(TRUST)));
} else {
  console.warn('  (no recursiveDelete — this SDK version needs a fresh emulator)');
}

await db.doc(paths.trust(TRUST)).set({ name: 'परीक्षा ट्रस्ट', branding: {} });
await db.doc(paths.program(TRUST, PROGRAM)).set({
  name: 'मासिक योजना',
  commissionPolicy: {
    joinFee: { enabled: false, mode: 'percent', value: 0, slabs: [] },
    collection: { enabled: true, mode: 'percent', value: 10, slabs: [] },
    minPayout: 0,
    autoApprove: true,
  },
  counters: { dueAmount: 0, paidAmount: 0 },
});
await db.doc(paths.agent(TRUST, AGENT)).set({
  displayName: 'एजेंट',
  email: 'agent@example.test',
  active: true,
  delete_flag: false,
  memberCount: 0,
  collectionCount: 0,
  collectedAmount: 0,
  commission: { earnedTotal: 0, paidTotal: 0, dueTotal: 0 },
  earnedTotal: 0,
  paidTotal: 0,
  dueTotal: 0,
});
await db.doc(paths.counterSeq(TRUST, PROGRAM)).set({ closing: 0, receipt: 0 });

/* ── 1. the batch and the closings ──────────────────────────────────────── */

const { id: batchId } = await createBatch(ADMIN, { name: 'अप्रैल-2026' });

// Four members close in April: the 3rd, the 4th, two on the 5th, one on the 6th.
const closers = ['बंद-3', 'बंद-4', 'बंद-5क', 'बंद-5ख', 'बंद-6'];
for (const [i, name] of closers.entries()) {
  await member(`m${i + 10}`, { displayName: name });
}
const payers = ['क', 'ख', 'ग', 'घ', 'ङ'];
for (const [i, name] of payers.entries()) {
  await member(`p${i + 1}`, { displayName: name });
}

const made = [];
for (const [i, name] of closers.entries()) {
  // eslint-disable-next-line no-await-in-loop
  const closing = await createClosing(ADMIN, {
    memberId: `m${i + 10}`,
    closingDateMs: day([3, 4, 5, 5, 6][i]),
    batchId,
  });
  made.push(closing);
}
const [c3, c4, c5a, c5b, c6] = made;

await check('each closing lands in the index inside its own transaction', async () => {
  const index = await readIndex();
  assert.equal(index.length, 5, 'five closings in the index');
  assert.deepEqual(index.map((c) => c.dateMs), [day(3), day(4), day(5), day(5), day(6)]);
  assert.equal(index.filter((c) => c.batchId === batchId).length, 5, 'all five carry the batch');
  assert.ok(index.every((c) => c.status === 'active'));
});

await check('the index agrees with the documents, not just with itself', async () => {
  const index = await readIndex();
  for (const entry of index) {
    const doc = await readClosing(entry.id);
    assert.equal(doc.seq, entry.seq);
    assert.equal(doc.status, entry.status, `status of #${entry.seq}`);
    assert.equal(doc.batchId, entry.batchId, `batch of #${entry.seq}`);
  }
});

/* ── 2. what each member owes ───────────────────────────────────────────── */

await check('a payer owes every closing up to the last one that happened', async () => {
  const p1 = await readMember('p1');
  const due = computeDue(p1, await readIndex());
  assert.deepEqual(due.dueSeqs, [c3.seq, c4.seq, c5a.seq, c5b.seq, c6.seq]);
  assert.equal(due.dueAmount, 1000);
});

await check('the April-5 pair owe each other, and nobody owes their own', async () => {
  const m12 = await readMember('m12');
  const due = computeDue(m12, await readIndex());
  // बंद-5क closed on the 5th: the 3rd, 4th and 5ब's closing, not its own.
  assert.deepEqual(due.dueSeqs.sort((a, b) => a - b), [c3.seq, c4.seq, c5b.seq].sort((a, b) => a - b));
  assert.equal(due.dueSeqs.includes(c5a.seq), false, 'never their own closing');
});

await check('the earliest closing owes nothing, and the next one owes only the 3rd', async () => {
  // Nobody else closed on or before the 3rd, so the 3rd's member owes nothing —
  // their own closing is never theirs.
  const earliest = computeDue(await readMember('m10'), await readIndex());
  assert.deepEqual(earliest.dueSeqs, []);
  // The 4th's member owes the 3rd and nothing after their own closing.
  const second = computeDue(await readMember('m11'), await readIndex());
  assert.deepEqual(second.dueSeqs, [c3.seq]);
});

await check('the last one owes everything that happened up to the 6th', async () => {
  const last = computeDue(await readMember('m14'), await readIndex());
  assert.deepEqual(
    last.dueSeqs.slice().sort((a, b) => a - b),
    [c3.seq, c4.seq, c5a.seq, c5b.seq].sort((a, b) => a - b),
    'everybody else’s, including the two 5ths, but not its own 6th',
  );
});

await check('the collection screen and the ledger agree on every member', async () => {
  const report = await collectionReport(ADMIN, { batchId });
  for (const row of report.rows) {
    const stored = await readMember(row.id);
    const due = computeDue(stored, await readIndex());
    assert.equal(row.dueAmount, money(due.dueAmount), `due for ${row.id}`);
  }
  // Eight of the nine owe something. The member who closed on the 3rd owes
  // nobody's closing — not even their own — so they are not on the sheet, which
  // is the point of the rule rather than an omission.
  assert.deepEqual(
    report.rows.map((r) => r.id).sort(),
    ['m11', 'm12', 'm13', 'm14', 'p1', 'p2', 'p3', 'p4', 'p5'],
  );
  assert.equal(report.rows.some((r) => r.id === 'm10'), false);
});

/* ── 3. money in ────────────────────────────────────────────────────────── */

const first = await postPayment(ADMIN, {
  memberId: 'p1',
  seqs: [c3.seq, c4.seq],
  collectedByAgentId: AGENT,
  paidAtMs: day(10),
  method: 'cash',
});

await check('a receipt lands, and the member ledger matches it line for line', async () => {
  const p1 = await readMember('p1');
  assert.equal(p1.paidCount, 2);
  assert.equal(p1.paidAmount, 400);
  assert.equal(p1.paidUpTo, c4.seq, 'watermark absorbed the run of two');
  assert.equal(p1.dueAmount, 600);
  assert.equal(first.receipt.totalAmount, 400);
  assert.deepEqual(first.receipt.seqs, [c3.seq, c4.seq]);
  assert.ok(first.receipt.receiptNo.length > 0);
});

await check('the closings’ own counters moved with it', async () => {
  assert.equal((await readClosing(c3.id)).paidCount, 1);
  assert.equal((await readClosing(c3.id)).paidAmount, 200);
  assert.equal((await readClosing(c5a.id)).paidCount, 0);
});

await check('the agent earned 10% of what it collected', async () => {
  const agent = await readAgent();
  assert.equal(agent.earnedTotal, 40);
  assert.equal(agent.dueTotal, 40);
  assert.equal(agent.collectedAmount, 400);
  assert.equal(agent.collectionCount, 2);
  assert.equal((await readStats()).commission.earnedTotal, 40);
});

await check('paying twice with the same key returns the same receipt, not a second one', async () => {
  // This is what a dropped connection on a village road looks like: the agent
  // taps "collect" again. It must not become a second ₹400.
  const once = await postPayment(ADMIN, {
    memberId: 'p5',
    seqs: [c3.seq, c4.seq],
    collectedByAgentId: AGENT,
    paidAtMs: day(10),
    method: 'cash',
    idempotencyKey: 'retry-me',
  });
  const replay = await postPayment(ADMIN, {
    memberId: 'p5',
    // A retry also re-sends whatever the screen had selected, which may not
    // match the original request exactly.
    seqs: [c3.seq, c4.seq, c5a.seq],
    collectedByAgentId: AGENT,
    paidAtMs: day(10),
    method: 'cash',
    idempotencyKey: 'retry-me',
  });

  assert.equal(replay.receipt.id, once.receipt.id, 'the very same receipt comes back');
  assert.equal(replay.receipt.receiptNo, once.receipt.receiptNo);
  assert.equal((await payments('p5')).length, 1, 'still one receipt for this member');
  const p5 = await readMember('p5');
  assert.equal(p5.paidAmount, 400, 'and the money was taken once');
  assert.equal(p5.paidCount, 2);
});

await check('one agent’s key cannot pay another member’s bill', async () => {
  // Idempotency is scoped to the request, not to the key alone. Without this a
  // guessed or copied key would silently return somebody else’s receipt.
  await assert.rejects(
    () => postPayment(ADMIN, {
      memberId: 'p4',
      seqs: [c3.seq],
      collectedByAgentId: AGENT,
      paidAtMs: day(10),
      method: 'cash',
      idempotencyKey: 'retry-me',
    }),
    /another member/i,
  );
});

await check('a part payment is money taken, not a closed instalment', async () => {
  const part = await postPayment(ADMIN, {
    memberId: 'p2',
    seqs: [c3.seq],
    amounts: { [c3.seq]: 50 },
    collectedByAgentId: AGENT,
    paidAtMs: day(11),
    method: 'cash',
  });
  assert.equal(part.receipt.totalAmount, 50);
  const p2 = await readMember('p2');
  assert.equal(p2.paidCount, 0, 'a half-paid instalment is not a paid one');
  assert.equal(p2.paidAmount, 50);
  assert.equal(p2.partialPaid[c3.seq], 50);
  assert.equal(p2.dueAmount, 950);
  // Commission follows the money actually taken, so a ₹50 part payment earns
  // ₹5 and not ₹20 — otherwise every short collection would pay full commission.
  // 40 from p1 + 40 from p5 + 5 from here.
  assert.equal(summariseEntries(await commissionEntries()).collectionTotal, 85);
});

await check('a bulk deposit is one call and one receipt per member', async () => {
  const bulk = await bulkCollect(AGENT_SCOPE, {
    memberIds: ['p3', 'p4'],
    amount: 2000,
    paidAtMs: day(12),
    method: 'cash',
    idempotencyKey: 'round-11',
  });
  assert.equal(bulk.receiptCount, 2);
  assert.equal(bulk.collected, 2000);
  assert.equal(bulk.leftover, 0, 'the whole deposit was placed, nothing left over');
  for (const id of ['p3', 'p4']) {
    const m = await readMember(id);
    assert.equal(m.paidCount, 5);
    assert.equal(m.paidAmount, 1000);
    assert.equal(m.dueAmount, 0);
  }
  // An agent may only bank in for their OWN members. Somebody else's round is
  // not this agent's to collect, no matter how much money is in their hand.
  await db.doc(paths.member(TRUST, 'p6')).set({
    programId: PROGRAM,
    registrationNumber: 'V100999',
    displayName: 'छह',
    fatherName: 'पिता',
    phone: '9000000006',
    village: 'गाँव',
    district: 'जिला',
    status: MEMBER_STATUS.ACCEPTED,
    agentId: 'someone-else',
    agentName: 'दूसरा',
    ageGroupRange: '23-45',
    payAmount: 200,
    joinDateMs: day(1, 0),
    joinFees: 0,
    joinFeesDone: true,
    paidUpTo: 0,
    paidSeqs: [],
    exemptSeqs: [],
    partialPaid: {},
    dueCount: 0,
    dueAmount: 0,
    paidCount: 0,
    paidAmount: 0,
    delete_flag: false,
    createdAt: serverNow(),
  });

  await assert.rejects(
    () => bulkCollect(AGENT_SCOPE, {
      memberIds: ['p6'],
      amount: 1000,
      paidAtMs: day(12),
      method: 'cash',
      idempotencyKey: 'round-13',
    }),
    /not assigned to you/i,
    'refused, and refused as a refusal — not a silent zero the agent could read as "banked"',
  );
  const p6 = await readMember('p6');
  assert.equal(p6.paidAmount, 0, 'and no money was taken from them');
  assert.equal(p6.paidCount, 0);
});

/* ── 4. cancelling a receipt ────────────────────────────────────────────── */

const beforeCancel = await readMember('p1');

await check('cancelling a receipt gives the money back and the instalments too', async () => {
  const out = await cancelPayment(ADMIN, first.receipt.id, { reason: 'गलती', uid: 'u-admin' });
  assert.equal(out.refundAmount, 400);
  const p1 = await readMember('p1');
  assert.equal(p1.paidAmount, 0);
  assert.equal(p1.paidCount, 0);
  assert.equal(p1.dueAmount, 1000);
  assert.ok(p1.dueAmount > beforeCancel.dueAmount);
  const receipt = (await payments('p1'))[0];
  assert.equal(receipt.status, PAYMENT_STATUS.CANCELLED);
  assert.equal(receipt.cancelReason, 'गलती');
  assert.equal(receipt.cancelledBy, 'u-admin');
});

await check('cancelling takes the agent’s commission back with it', async () => {
  const agent = await readAgent();
  // ₹2,850 was collected at 10% = ₹285. p1's ₹400 receipt is cancelled, so its
  // ₹40 goes back with it.
  assert.equal(agent.earnedTotal, 245, 'the 40 from p1 is gone');
  assert.equal(agent.dueTotal, agent.earnedTotal);
  assert.equal(agent.collectionCount, 13, 'and its two closings are no longer collections');
  assert.equal(agent.collectedAmount, 2450);
  assert.equal((await readStats()).commission.earnedTotal, agent.earnedTotal);

  const summary = summariseEntries(await commissionEntries());
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.collectionTotal, 245, 'the entries add up to the same figure');
  // The counter and the entries are two views of one number. If they ever drift,
  // a payout would pay out of a total that was never earned.
  assert.equal(round2(summary.collectionTotal), round2(agent.earnedTotal));
});

await check('the same receipt cannot be cancelled twice', async () => {
  await assert.rejects(
    () => cancelPayment(ADMIN, first.receipt.id, { reason: 'और', uid: 'u-admin' }),
    /already cancelled/i,
  );
});

/* ── 5. reverting a closing ─────────────────────────────────────────────── */

const closeBefore = await readClosing(c5a.id);
const indexBefore = (await readIndex()).map((c) => c.id);

await check('reverting reverses every payer, keeps the document, retires the seq', async () => {
  const out = await revertClosing(ADMIN, c5a.id, { reason: 'गलत समय', uid: 'u-admin' });
  // p3 and p4 paid it in their round. p1's receipt was cancelled a moment ago,
  // so there is nothing live to reverse for them — counting it would mean
  // reversing money that was already returned.
  assert.equal(out.affectedReceipts, 2, 'only the two live round receipts');
  assert.equal(out.reversedAmount, 400, '₹200 each');

  const closing = await readClosing(c5a.id);
  assert.equal(closing.status, 'reverted', 'the document survives, marked reverted');
  assert.equal(closing.paidCount, 0);
  assert.equal(closing.paidAmount, 0);
  assert.ok(closing.revertedAt, 'with a timestamp and an author');
  assert.ok(closeBefore.seq === closing.seq, 'the seq stays retired, never reused');

  const index = (await readIndex()).map((c) => c.id);
  assert.equal(index.length, indexBefore.length, 'no closing is removed from the index');
  assert.equal((await readIndex()).find((c) => c.id === c5a.id).status, 'reverted');
});

await check('every payer got their money back as credit, and only that instalment', async () => {
  for (const id of ['p3', 'p4']) {
    const m = await readMember(id);
    assert.equal(m.creditBalance ?? 0, 200, `${id} has ₹200 credit`);
    // Their other four instalments are untouched — this is one closing going
    // back, not their whole round being undone.
    assert.equal(m.paidAmount, 800, `${id} keeps the other four`);
    assert.equal(m.paidCount, 4);
  }
  // Nobody else had paid it, so nobody else moves.
  assert.equal((await readMember('p2')).creditBalance ?? 0, 0);
  assert.equal((await readMember('p5')).creditBalance ?? 0, 0);
  assert.equal((await readMember('p5')).paidAmount, 400, 'p5 only ever paid the 3rd and 4th');
});

await check('the agent gave back only the share the reverted instalment earned', async () => {
  const agent = await readAgent();
  // Each round receipt earned 10% of ₹1,000 = ₹100. Reverting one ₹200
  // instalment takes back ₹20 of it — not the ₹100, because the other four
  // closings in that receipt were collected perfectly well.
  assert.equal(agent.earnedTotal, 245 - 40, '₹20 from each of the two receipts');
  assert.equal(agent.dueTotal, agent.earnedTotal);
  assert.equal(agent.collectionCount, 11, 'one closing no longer counts as collected, twice over');
  assert.equal(agent.collectedAmount, 2050, '₹400 of collection went back');

  const summary = summariseEntries(await commissionEntries());
  assert.equal(summary.collectionTotal, 205, 'reports count the net, not the gross');
  assert.equal(round2(summary.collectionTotal), round2(agent.earnedTotal),
    'the counter and the entries are one number, two views');

  const reversed = (await commissionEntries()).filter((e) => e.reversedAmount > 0);
  assert.equal(reversed.length, 2, 'each entry records what was taken');
  for (const e of reversed) {
    assert.equal(round2(e.reversedAmount), 20);
    assert.equal(e.status, 'approved', 'a partly reversed entry is still payable for the rest');
    assert.equal(netAmount(e), round2(e.amount) - 20);
  }
});

await check('a payout pays the net, and the agent’s balance lands on zero', async () => {
  const entries = (await commissionEntries()).filter((e) => e.status === 'approved');
  const payout = await createPayout(ADMIN, { agentId: AGENT, entryIds: entries.map((e) => e.id), method: 'cash' });
  // The payout is on the NET of 205, not on the 245 that was originally earned —
  // paying the gross would hand the agent ₹40 for a collection that went back.
  assert.equal(payout.grossTotal, 205);

  const agent = await readAgent();
  assert.equal(agent.dueTotal, 0, 'nothing left owing');
  assert.equal(agent.paidTotal, 205);

  const after = await commissionEntries();
  const paid = after.filter((e) => e.payoutId === payout.id);
  assert.equal(paid.length, entries.length);
  assert.ok(paid.every((e) => e.status === 'paid'));
  assert.equal(round2(paid.reduce((s, e) => s + netAmount(e), 0)), 205);
});

await check('a reverted closing cannot be paid', async () => {
  await assert.rejects(
    () => postPayment(ADMIN, {
      memberId: 'p2',
      seqs: [c5a.seq],
      amounts: { [c5a.seq]: 200 },
      collectedByAgentId: AGENT,
      paidAtMs: day(13),
      method: 'cash',
    }),
    (err) => {
      assert.equal(err.status, 409);
      // The reason must name the closing as reverted. "Already paid" would send
      // the operator looking for a receipt that does not exist.
      assert.equal(err.details.rejected[0].reason, 'closing_reverted');
      return true;
    },
  );
  const p2 = await readMember('p2');
  assert.equal(p2.paidAmount, 50, 'nothing extra was taken');
  assert.equal(p2.paidCount, 0);
});

await check('reverting the same closing twice is refused, not doubled', async () => {
  await assert.rejects(
    () => revertClosing(ADMIN, c5a.id, { reason: 'और', uid: 'u-admin' }),
    /already reverted/i,
  );
  const p3 = await readMember('p3');
  assert.equal(p3.creditBalance, 200, 'the credit was not given twice');
});

await check('the notice and the bills leave the reverted closing out', async () => {
  const { billBatch } = await import('../src/lib/batchBilling.js');
  const bills = billBatch(
    (await getMembersIndex(TRUST, { fresh: true })).items,
    await readIndex(),
    { programId: PROGRAM },
  );
  assert.ok(bills.length > 0, 'there are still bills to print');
  for (const bill of bills) {
    assert.equal(
      bill.closings.some((c) => c.seq === c5a.seq), false,
      `${bill.member.id} must not be billed for a reverted closing`,
    );
  }
});

/* ── 6. re-create after a revert ────────────────────────────────────────── */

await check('the member can be closed again, and a NEW closing is raised', async () => {
  const restored = await readMember('m12');
  assert.equal(restored.status, MEMBER_STATUS.ACCEPTED, 'back to accepted');
  assert.equal(restored.closingId, null);
  assert.equal(restored.exitDateMs, null);
  assert.equal(restored.creditBalance ?? 0, 0);

  const again = await createClosing(ADMIN, {
    memberId: 'm12',
    closingDateMs: day(20),
    batchId,
  });
  assert.notEqual(again.seq, c5a.seq, 'a new seq — the old one stays retired');
  const m12 = await readMember('m12');
  assert.equal(m12.status, MEMBER_STATUS.CLOSED);
  assert.equal(m12.closingDateMs, day(20));

  // m12 has now been closed twice, and the same rule holds both times: they owe
  // everybody else's closing up to and including their own closing date, never
  // their own, and never the retired one.
  const due = computeDue(m12, await readIndex());
  assert.equal(due.dueSeqs.includes(again.seq), false, 'still never their own closing');
  assert.equal(due.dueSeqs.includes(c5a.seq), false, 'and not the retired one');
  assert.deepEqual(
    due.dueSeqs.slice().sort((a, b) => a - b),
    [c3.seq, c4.seq, c5b.seq, c6.seq].sort((a, b) => a - b),
    'the 3rd, 4th, the other 5th and the 6th — everything up to their own 20th',
  );
});

await check('a date edit on a live closing is refused — it would rewrite ledgers', async () => {
  const { updateClosing } = await import('../src/server/domain/closings.js');
  await assert.rejects(
    () => updateClosing(ADMIN, c3.id, { closingDateMs: day(25) }),
    /date|तारीख/i,
  );
  assert.equal((await readClosing(c3.id)).closingDateMs, day(3), 'the date is untouched');
});

await check('moving a closing between batches moves it in the index too', async () => {
  const { id: other } = await createBatch(ADMIN, { name: 'मई-2026' });
  await setClosingBatch(ADMIN, other, [c6.id]);
  assert.equal((await readClosing(c6.id)).batchId, other);
  assert.equal((await readIndex()).find((c) => c.id === c6.id).batchId, other, 'index followed');
  await setClosingBatch(ADMIN, batchId, [c6.id]);
  assert.equal((await readClosing(c6.id)).batchId, batchId);
  assert.equal((await readIndex()).find((c) => c.id === c6.id).batchId, batchId);
});

/* ── 7. the read surfaces ───────────────────────────────────────────────── */

await check('the members index answers "who owes what" without a read per member', async () => {
  await rebuildMembersIndex(TRUST);
  const index = await getMembersIndex(TRUST, { fresh: true });
  for (const entry of index.items) {
    const stored = await readMember(entry.id);
    const due = computeDue(stored, await readIndex());
    assert.equal(entry.due, money(due.dueAmount), `indexed due for ${entry.id}`);
    assert.equal(entry.dueC, due.dueCount, `indexed count for ${entry.id}`);
  }
});

await check('the closing’s collection screen is derived, not a stored counter', async () => {
  const out = await getClosingCollection(ADMIN, c3.id, {});
  assert.ok(out.rows.length > 0);
  for (const row of out.rows) {
    const stored = await readMember(row.memberId);
    const due = computeDue(stored, await readIndex()).dueItems
      .find((i) => i.seq === c3.seq);
    assert.equal(money(row.remaining), money(due ? due.remaining : 0), `remaining for ${row.memberId}`);
  }
  // The header totals are the same arithmetic as the rows, not a separate counter
  // that could disagree with them.
  assert.equal(out.closing.eligibleCount, out.rows.length);
  assert.equal(out.closing.pendingCount, out.rows.filter((r) => r.remaining > 0).length);
  assert.equal(
    money(out.closing.pendingAmount),
    money(out.rows.reduce((s, r) => s + r.remaining, 0)),
    'the pending figure is the sum of the rows',
  );
  assert.equal(
    money(out.closing.paidAmount),
    money(out.rows.reduce((s, r) => s + r.paidAmount, 0)),
  );
  assert.equal(
    money(out.byAgeBand.reduce((s, b) => s + (b.pendingAmount ?? 0), 0)),
    money(out.closing.pendingAmount),
    'and the band breakdown adds up to the same number',
  );
});

await check('the list of closings hides the reverted one unless asked', async () => {
  const live = await listClosings(ADMIN);
  const all = await listClosings(ADMIN, { includeReverted: true });
  assert.equal(live.closings.some((c) => c.id === c5a.id), false);
  assert.equal(all.closings.some((c) => c.id === c5a.id), true);
});

await check('the audit log recorded the revert, with a reason and an author', async () => {
  const snap = await db.doc(`${paths.auditLogs(TRUST, PROGRAM)}/closing_revert_${c5a.id}`).get();
  assert.ok(snap.exists, 'the audit entry is written inside the revert transaction');
  const log = snap.data();
  assert.equal(log.reason, 'गलत समय');
  assert.equal(log.by, 'u-admin');
  assert.equal(log.affectedReceipts, 2, 'the two live receipts it reversed');
  assert.equal(log.reversedAmount, 400);
  // The commission taken back is part of the record too — it is money the trust
  // did not keep.
  assert.equal(log.commissionClawedBack, 40);
  assert.ok(log.at, 'and it is stamped');
});

/* ── the joining-fee stream ───────────────────────────────────────────────── */

/**
 * Everything above earns the COLLECTION stream, and every one of those checks
 * passes with `joinFee` switched off. That is the gap this section closes.
 *
 * A joining fee arrives on a receipt carrying NO closing at all — which is
 * exactly the shape a guard of the form "no closing total, no commission"
 * rejects, and that guard would quietly stop an agent being paid for bringing
 * members in. The trust turns that stream on first, so it is the one that must
 * be proved end to end rather than only in `commission.test.js`.
 *
 * Placed after the payout so it cannot perturb a single figure asserted above;
 * it reads what it needs from its own `before` snapshot.
 */
await check('a joining fee earns commission on a receipt with no closing on it', async () => {
  await db.doc(paths.program(TRUST, PROGRAM)).set({
    commissionPolicy: {
      joinFee: { enabled: true, mode: 'percent', value: 5, slabs: [] },
      collection: { enabled: true, mode: 'percent', value: 10, slabs: [] },
      minPayout: 0,
      autoApprove: true,
    },
  }, { merge: true });

  // `joinFeesDone: true` is the legacy "this member never had one" flag and
  // would read as nothing due, so the fee has to be set the way an enrolled
  // member's actually is: an amount, and no settlement against it yet.
  await member('join-1', { joinFees: 5000, joinFeesDone: false });

  const before = await readAgent();
  const seen = new Set((await commissionEntries()).map((e) => e.id));

  const result = await postPayment(ADMIN, {
    memberId: 'join-1',
    seqs: [],
    joinFeeAmount: 5000,
    collectedByAgentId: AGENT,
    paidAtMs: day(20),
    method: 'cash',
  });

  const receipt = result.receipt;
  assert.equal(receipt.joinFeeAmount, 5000, 'the receipt carries the joining fee');
  assert.equal(receipt.closingAmount ?? 0, 0, 'and nothing else — this is the receipt shape under test');
  assert.equal(receipt.totalAmount, 5000);

  const created = (await commissionEntries()).filter((e) => !seen.has(e.id));
  assert.equal(created.length, 1, 'exactly one entry, not one per stream-shaped nothing');
  const entry = created[0];
  assert.equal(entry.type, COMMISSION_TYPE.JOIN_FEE, 'it is the joining-fee stream, named as such');
  assert.equal(entry.amount, 250, '5% of ₹5000');
  assert.equal(entry.baseAmount, 5000);

  const agent = await readAgent();
  assert.equal(
    agent.earnedTotal, round2(before.earnedTotal + 250),
    'the joining fee reached the agent’s earnings',
  );
  assert.equal(agent.dueTotal, round2(before.dueTotal + 250), 'and its payable half too');
  assert.equal(agent.collectionCount, before.collectionCount,
    'a joining fee is not a collection — the slab the collection stream counts by must not move');
  assert.equal(agent.collectedAmount, before.collectedAmount, 'nor the collection total');

  const stats = await readStats();
  assert.equal(stats.commission.earnedTotal, agent.earnedTotal,
    'the trust-wide figure and the agent’s own agree');

  const joiner = await readMember('join-1');
  assert.equal(joiner.joinFeesPaid, 5000, 'the member’s fee is settled');
  assert.equal(joiner.joinFeesDone, true);
});

await db.terminate();
console.log(`\n${checks} checks passed.\n`);
