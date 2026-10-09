/**
 * Ledger tests.  Run with:  npm test
 *
 * These are the most important tests in the project. Every rupee the trust
 * collects passes through the functions under test here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isEligible,
  amountFor,
  computeDue,
  compactLedger,
  applyPayment,
  reversePayment,
  reverseReceiptItems,
  applyExemption,
  rebuildLedger,
  readLedger,
  replanForDates,
} from './ledger.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const D = (n) => Date.UTC(2024, 0, 1) + n * DAY; // D(0) = 2024-01-01

/** 10 closings, one per day starting D(10), ₹200 each. */
const closings = Array.from({ length: 10 }, (_, i) => ({
  seq: i + 1,
  id: `c${i + 1}`,
  memberId: `owner${i + 1}`,
  name: `Closing ${i + 1}`,
  regNo: `${1000 + i}`,
  dateMs: D(10 + i),
  amount: 200,
  status: 'active',
}));

const member = (over = {}) => ({
  id: 'm1',
  joinDateMs: D(0),
  exitDateMs: null,
  payAmount: 200,
  paidUpTo: 0,
  paidSeqs: [],
  exemptSeqs: [],
  partialPaid: {},
  ...over,
});

/* ── eligibility ──────────────────────────────────────────────────────────── */

test('eligible when joined before the closing', () => {
  assert.equal(isEligible(member(), closings[0]), true);
});

test('not eligible when joined after the closing', () => {
  assert.equal(isEligible(member({ joinDateMs: D(15) }), closings[0]), false);
});

test('eligible when joined exactly on the closing date', () => {
  assert.equal(isEligible(member({ joinDateMs: D(10) }), closings[0]), true);
});

test('not eligible for own closing', () => {
  assert.equal(isEligible(member({ id: 'owner3' }), closings[2]), false);
});

test('not eligible once exited on or before the closing date', () => {
  const m = member({ exitDateMs: D(12) }); // closed on the day of seq 3
  assert.equal(isEligible(m, closings[1]), true);  // seq 2, D(11)
  assert.equal(isEligible(m, closings[2]), false); // seq 3, D(12) — same day
  assert.equal(isEligible(m, closings[3]), false); // seq 4, later
});

test('closed members owe other closings on their closing date inclusively', () => {
  const m = member({ status: 'closed', closingDateMs: D(12), exitDateMs: D(12) });
  assert.equal(isEligible(m, closings[2]), true);
  assert.equal(isEligible(m, closings[3]), false);
  assert.equal(isEligible({ ...m, id: 'owner3' }, closings[2]), false);
});

test('reverted closings are never owed', () => {
  assert.equal(
    isEligible(member(), { ...closings[0], status: 'reverted' }),
    false,
  );
});

test('a closing in the middle of reversal cannot be paid', () => {
  const reverting = { ...closings[0], status: 'reverting' };
  assert.equal(isEligible(member(), reverting), false);
  assert.equal(applyPayment(member(), [1], [reverting]).accepted.length, 0);
});

test('a missing join date owes nothing (fail closed, never invent debt)', () => {
  assert.equal(isEligible(member({ joinDateMs: undefined }), closings[0]), false);
});

/* ── amounts ──────────────────────────────────────────────────────────────── */

test("amount precedence: override > member rate > closing rate > default", () => {
  assert.equal(amountFor({ payAmount: 300 }, { amount: 200 }), 300);
  assert.equal(amountFor({ payAmount: 300 }, { amount: 200, amountOverride: 50 }), 50);
  assert.equal(amountFor({}, { amount: 200 }), 200);
  assert.equal(amountFor({}, {}), 200); // LIMITS.DEFAULT_PAY_AMOUNT
});

/* ── due computation ──────────────────────────────────────────────────────── */

test('a brand-new fully-unpaid member owes every eligible closing', () => {
  const r = computeDue(member(), closings);
  assert.equal(r.dueCount, 10);
  assert.equal(r.dueAmount, 2000);
});

test('the watermark settles everything below it in one integer', () => {
  const r = computeDue(member({ paidUpTo: 7 }), closings);
  assert.deepEqual(r.dueSeqs, [8, 9, 10]);
  assert.equal(r.dueAmount, 600);
  assert.equal(r.settledCount, 7);
});

test('out-of-order paid seqs are honoured', () => {
  const r = computeDue(member({ paidUpTo: 3, paidSeqs: [5, 9] }), closings);
  assert.deepEqual(r.dueSeqs, [4, 6, 7, 8, 10]);
});

test('exempt seqs are not due and not counted as paid', () => {
  const r = computeDue(member({ paidUpTo: 3, exemptSeqs: [4, 5] }), closings);
  assert.deepEqual(r.dueSeqs, [6, 7, 8, 9, 10]);
  assert.equal(r.exemptCount, 2);
});

test('a partial payment leaves only the remainder due', () => {
  const r = computeDue(member({ partialPaid: { 1: 50 } }), closings);
  assert.equal(r.dueItems[0].remaining, 150);
  assert.equal(r.dueItems[0].partial, true);
  assert.equal(r.dueAmount, 2000 - 50);
});

test('a late joiner only owes closings from their join date onward', () => {
  const r = computeDue(member({ joinDateMs: D(14) }), closings);
  assert.deepEqual(r.dueSeqs, [5, 6, 7, 8, 9, 10]);
});

test("a member's own closing is skipped in the middle of the range", () => {
  const r = computeDue(member({ id: 'owner4' }), closings);
  assert.equal(r.dueSeqs.includes(4), false);
  assert.equal(r.dueCount, 9);
});

/* ── compaction ───────────────────────────────────────────────────────────── */

test('a contiguous run of paid seqs collapses into the watermark', () => {
  const c = compactLedger(
    { paidUpTo: 0, paidSeqs: [1, 2, 3, 4, 7], exemptSeqs: [], partialPaid: {} },
    member(),
    closings,
  );
  assert.equal(c.paidUpTo, 4);
  assert.deepEqual(c.paidSeqs, [7]);
});

test('compaction jumps over ineligible seqs (own closing / pre-join)', () => {
  // owner2 never owes seq 2, so paying 1 and 3 should compact past it.
  const c = compactLedger(
    { paidUpTo: 0, paidSeqs: [1, 3], exemptSeqs: [], partialPaid: {} },
    member({ id: 'owner2' }),
    closings,
  );
  assert.equal(c.paidUpTo, 3);
  assert.deepEqual(c.paidSeqs, []);
});

test('a fully paid-up member compacts to a single integer and an empty array', () => {
  const c = compactLedger(
    {
      paidUpTo: 0,
      paidSeqs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      exemptSeqs: [],
      partialPaid: {},
    },
    member(),
    closings,
  );
  assert.equal(c.paidUpTo, 10);
  assert.deepEqual(c.paidSeqs, []);
});

/* ── payment ──────────────────────────────────────────────────────────────── */

test('paying the first three closings settles them and compacts', () => {
  const r = applyPayment(member(), [1, 2, 3], closings);
  assert.equal(r.accepted.length, 3);
  assert.equal(r.totalAmount, 600);
  assert.equal(r.ledger.paidUpTo, 3);
  assert.equal(r.counters.dueCount, 7);
  assert.equal(r.counters.dueAmount, 1400);
});

test('DOUBLE SUBMIT cannot charge twice — the second is rejected', () => {
  const m = member();
  const first = applyPayment(m, [1, 2, 3], closings);
  const after = { ...m, ...first.ledger };

  const second = applyPayment(after, [1, 2, 3], closings);
  assert.equal(second.accepted.length, 0);
  assert.equal(second.totalAmount, 0);
  assert.deepEqual(
    second.rejected.map((r) => r.reason),
    ['already_paid', 'already_paid', 'already_paid'],
  );
});

test('a stale tab paying an ineligible closing is rejected, not charged', () => {
  const r = applyPayment(member({ joinDateMs: D(14) }), [1, 2, 5], closings);
  assert.deepEqual(r.accepted.map((a) => a.seq), [5]);
  assert.deepEqual(
    r.rejected.map((x) => x.reason),
    ['not_eligible', 'not_eligible'],
  );
  assert.equal(r.totalAmount, 200);
});

test('paying a reverted closing is rejected', () => {
  const cs = closings.map((c) => (c.seq === 2 ? { ...c, status: 'reverted' } : c));
  const r = applyPayment(member(), [1, 2, 3], cs);
  assert.deepEqual(r.accepted.map((a) => a.seq), [1, 3]);
  assert.equal(r.rejected[0].reason, 'closing_reverted');
  // seq 2 is a gap, so the watermark still walks past it
  assert.equal(r.ledger.paidUpTo, 3);
});

test('a partial payment is recorded and the rest stays due', () => {
  const r = applyPayment(member(), [1], closings, { amounts: { 1: 50 } });
  assert.equal(r.totalAmount, 50);
  assert.equal(r.ledger.paidUpTo, 0);
  assert.equal(r.ledger.partialPaid[1], 50);
  assert.equal(r.counters.dueAmount, 1950);

  const r2 = applyPayment({ ...member(), ...r.ledger }, [1], closings);
  assert.equal(r2.totalAmount, 150); // only the remainder
  assert.equal(r2.ledger.paidUpTo, 1);
});

test('overpaying a single closing is rejected', () => {
  const r = applyPayment(member(), [1], closings, { amounts: { 1: 500 } });
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].reason, 'amount_exceeds_due');
});

test('paying every closing leaves nothing due', () => {
  const r = applyPayment(member(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], closings);
  assert.equal(r.totalAmount, 2000);
  assert.equal(r.ledger.paidUpTo, 10);
  assert.deepEqual(r.ledger.paidSeqs, []);
  assert.equal(r.counters.dueCount, 0);
  assert.equal(r.counters.dueAmount, 0);
});

/* ── reversal ─────────────────────────────────────────────────────────────── */

test('cancelling a receipt puts the obligation back, below the watermark', () => {
  const paid = applyPayment(member(), [1, 2, 3, 4, 5], closings);
  assert.equal(paid.ledger.paidUpTo, 5);

  const rev = reversePayment({ ...member(), ...paid.ledger }, [2], closings);
  assert.equal(rev.ledger.paidUpTo, 1);
  assert.deepEqual(rev.ledger.paidSeqs, [3, 4, 5]); // 3-5 survive
  assert.equal(rev.counters.dueCount, 6);           // 2 plus 6..10
  assert.equal(rev.counters.paidAmountDelta, -200);
});

test('reversal is exactly undone by re-paying', () => {
  const m = member();
  const paid = applyPayment(m, [1, 2, 3, 4, 5], closings);
  const rev = reversePayment({ ...m, ...paid.ledger }, [2], closings);
  const again = applyPayment({ ...m, ...rev.ledger }, [2], closings);

  assert.equal(again.ledger.paidUpTo, paid.ledger.paidUpTo);
  assert.deepEqual(again.ledger.paidSeqs, paid.ledger.paidSeqs);
});

test('reversing something that was never paid is a no-op on the money', () => {
  const rev = reversePayment(member({ paidUpTo: 3 }), [9], closings);
  assert.equal(rev.counters.paidAmountDelta, 0);
  assert.equal(rev.reversed[0].was, 'not_paid');
});

test('cancelling the first instalment keeps the second instalment paid', () => {
  const first = applyPayment(member(), [1], closings, { amounts: { 1: 100 } });
  const second = applyPayment({ ...member(), ...first.ledger }, [1], closings);
  const reversed = reverseReceiptItems(
    { ...member(), ...second.ledger }, first.accepted, closings,
  );
  assert.equal(reversed.ledger.paidUpTo, 0);
  assert.equal(reversed.ledger.partialPaid[1], 100);
  assert.equal(reversed.counters.paidCountDelta, -1);
  assert.equal(reversed.counters.paidAmountDelta, -100);
  assert.equal(reversed.counters.dueAmount, 1900);
});

test('cancelling the final instalment also leaves the first paid', () => {
  const first = applyPayment(member(), [1], closings, { amounts: { 1: 50 } });
  const second = applyPayment({ ...member(), ...first.ledger }, [1], closings);
  const reversed = reverseReceiptItems(
    { ...member(), ...second.ledger }, second.accepted, closings,
  );
  assert.equal(reversed.ledger.partialPaid[1], 50);
  assert.equal(reversed.counters.paidAmountDelta, -150);
  assert.equal(reversed.counters.dueAmount, 1950);
});

test('reversing one partial receipt does not clear another partial receipt', () => {
  const first = applyPayment(member(), [1], closings, { amounts: { 1: 50 } });
  const second = applyPayment({ ...member(), ...first.ledger }, [1], closings, { amounts: { 1: 60 } });
  const reversed = reverseReceiptItems(
    { ...member(), ...second.ledger }, first.accepted, closings,
  );
  assert.equal(reversed.ledger.partialPaid[1], 60);
  assert.equal(reversed.counters.paidCountDelta, 0);
  assert.equal(reversed.counters.dueAmount, 1940);
});

test('reversing an instalment retains settlement on other sequences', () => {
  const first = applyPayment(member(), [1, 2, 3], closings);
  const reversed = reverseReceiptItems(
    { ...member(), ...first.ledger }, [first.accepted[1]], closings,
  );
  assert.deepEqual(computeDue({ ...member(), ...reversed.ledger }, closings).dueSeqs,
    [2, 4, 5, 6, 7, 8, 9, 10]);
});

/* ── exemption ────────────────────────────────────────────────────────────── */

test('exempting the next closings advances the watermark past them', () => {
  const r = applyExemption(member({ paidUpTo: 3 }), [4, 5], closings);
  assert.equal(r.ledger.paidUpTo, 5);
  assert.equal(r.counters.dueCount, 5);
});

test('an already-paid closing cannot be exempted', () => {
  const r = applyExemption(member({ paidUpTo: 5 }), [3], closings);
  assert.deepEqual(r.applied, []);
});

/* ── reconciliation ───────────────────────────────────────────────────────── */

test('a ledger rebuilt from receipts matches the incrementally-built one', () => {
  const m = member();
  const p1 = applyPayment(m, [1, 2, 3], closings);
  const s1 = { ...m, ...p1.ledger };
  const p2 = applyPayment(s1, [5, 7], closings);
  const s2 = { ...s1, ...p2.ledger };

  const receipts = [
    { status: 'completed', items: p1.accepted },
    { status: 'completed', items: p2.accepted },
  ];
  const rebuilt = rebuildLedger(m, closings, receipts);

  assert.equal(rebuilt.ledger.paidUpTo, s2.paidUpTo);
  assert.deepEqual(rebuilt.ledger.paidSeqs, s2.paidSeqs);
  assert.equal(rebuilt.counters.paidAmount, 1000);
  assert.equal(rebuilt.counters.paidCount, 5);
});

test('a cancelled receipt is excluded from a rebuild', () => {
  const m = member();
  const p1 = applyPayment(m, [1, 2], closings);
  const rebuilt = rebuildLedger(m, closings, [
    { status: 'cancelled', items: p1.accepted },
  ]);
  assert.equal(rebuilt.counters.paidAmount, 0);
  assert.equal(rebuilt.ledger.paidUpTo, 0);
});

/* ── scale ────────────────────────────────────────────────────────────────── */

test('SCALE: 500 closings — a paid-up ledger is one integer, not an array', () => {
  const big = Array.from({ length: 500 }, (_, i) => ({
    seq: i + 1,
    id: `c${i + 1}`,
    memberId: `o${i + 1}`,
    dateMs: D(10 + i),
    amount: 200,
    status: 'active',
  }));

  const seqs = Array.from({ length: 500 }, (_, i) => i + 1);
  const r = applyPayment(member(), seqs, big);

  assert.equal(r.totalAmount, 100_000);
  assert.equal(r.ledger.paidUpTo, 500);
  assert.deepEqual(r.ledger.paidSeqs, []); // the whole point of the design
  assert.equal(r.counters.dueCount, 0);

  // A stored ledger of {paidUpTo:500, paidSeqs:[]} is ~30 bytes.
  const bytes = JSON.stringify(r.ledger).length;
  assert.ok(bytes < 100, `ledger should stay tiny, got ${bytes} bytes`);
});

test('SCALE: worst case — 500 alternating unpaid seqs stay far under 1MB', () => {
  const big = Array.from({ length: 500 }, (_, i) => ({
    seq: i + 1,
    id: `c${i + 1}`,
    memberId: `o${i + 1}`,
    dateMs: D(10 + i),
    amount: 200,
    status: 'active',
  }));

  const evens = Array.from({ length: 250 }, (_, i) => (i + 1) * 2);
  const r = applyPayment(member(), evens, big);

  assert.equal(r.ledger.paidUpTo, 0); // seq 1 unpaid, nothing can compact
  assert.equal(r.ledger.paidSeqs.length, 250);
  const bytes = JSON.stringify(r.ledger).length;
  assert.ok(bytes < 5_000, `worst case should stay small, got ${bytes} bytes`);
});

test('SCALE: 5000 members × 500 closings computes without materialising rows', () => {
  const big = Array.from({ length: 500 }, (_, i) => ({
    seq: i + 1,
    id: `c${i + 1}`,
    memberId: `o${i + 1}`,
    dateMs: D(10 + i),
    amount: 200,
    status: 'active',
  }));

  const t0 = Date.now();
  let totalDue = 0;
  for (let i = 0; i < 5000; i += 1) {
    const m = member({
      id: `m${i}`,
      joinDateMs: D(i % 400),          // staggered joining
      paidUpTo: i % 300,
    });
    totalDue += computeDue(m, big).dueAmount;
  }
  const ms = Date.now() - t0;

  assert.ok(totalDue > 0);
  // The old system needed 2.5M Firestore documents for this. We need zero.
  assert.ok(ms < 15_000, `took ${ms}ms`);
});

/* ── defensive parsing ────────────────────────────────────────────────────── */

test('garbage in the ledger fields is normalised, never thrown on', () => {
  const l = readLedger({
    paidUpTo: '7',
    paidSeqs: [3, '3', null, -1, 9, undefined, 'x'],
    exemptSeqs: null,
    partialPaid: { 5: '50', bad: 'x', 6: -1 },
  });
  assert.equal(l.paidUpTo, 7);
  assert.deepEqual(l.paidSeqs, [3, 9]);
  assert.deepEqual(l.exemptSeqs, []);
  assert.deepEqual(l.partialPaid, { 5: 50 });
});

/* ── replanForDates: editing the joining date ─────────────────────────────── */

const acc = (extra) => ({ id: 'm1', status: 'accepted', payAmount: 200, ...extra });

test('replan: joining earlier makes the older closings due (they were only absorbed)', () => {
  // joined D(15) → closings 1-5 (D10..D14) never owed; watermark absorbed them.
  const before = acc({ joinDateMs: D(15) });
  const stored = { ...before, ...compactLedger(readLedger(before), before, closings) };
  assert.equal(stored.paidUpTo, 5);
  const after = { ...stored, joinDateMs: D(12) }; // now owes 3,4,5 too
  const r = replanForDates(stored, after, closings);
  assert.deepEqual(r.added.map((x) => x.seq), [3, 4, 5]);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.after.dueCount, 8); // 3..10
  assert.equal(r.before.dueCount, 5); // 6..10
  assert.equal(r.ledger.paidUpTo, 2);
});

test('replan: paid closings stay paid when joining earlier', () => {
  // joined D(15), paid closings 6 and 7.
  let m = acc({ joinDateMs: D(15) });
  m = { ...m, ...applyPayment(m, [6, 7], closings).ledger };
  const r = replanForDates(m, { ...m, joinDateMs: D(10) }, closings);
  assert.deepEqual(r.after.dueSeqs, [1, 2, 3, 4, 5, 8, 9, 10]);
  assert.equal(r.conflicts.length, 0);
});

test('replan: joining later than a PAID closing is a conflict, never a silent drop', () => {
  let m = acc({ joinDateMs: D(10) });
  m = { ...m, ...applyPayment(m, [1, 2], closings).ledger };
  const r = replanForDates(m, { ...m, joinDateMs: D(12) }, closings);
  assert.deepEqual(r.conflicts.map((x) => x.seq), [1, 2]);
  assert.deepEqual(r.removed.map((x) => x.seq), [1, 2]);
});

test('replan: joining later than UNPAID closings simply stops billing them', () => {
  const m = acc({ joinDateMs: D(10) });
  const r = replanForDates(m, { ...m, joinDateMs: D(13) }, closings);
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.removed.map((x) => x.seq), [1, 2, 3]);
  assert.equal(r.after.dueCount, 7);
});

test('replan: a new rate re-prices what is due, never what was paid', () => {
  let m = acc({ joinDateMs: D(10) });
  m = { ...m, ...applyPayment(m, [1], closings).ledger };
  const r = replanForDates(m, { ...m, payAmount: 300 }, closings);
  assert.equal(r.after.dueCount, 9);
  assert.equal(r.after.dueAmount, 9 * 300);
  assert.ok(!r.after.dueSeqs.includes(1));
});

test('replan: a part-paid closing keeps its part payment', () => {
  let m = acc({ joinDateMs: D(10) });
  m = { ...m, ...applyPayment(m, [3], closings, { amounts: { 3: 50 } }).ledger };
  const r = replanForDates(m, { ...m, joinDateMs: D(9) }, closings);
  const three = r.after.dueItems.find((d) => d.seq === 3);
  assert.equal(three.alreadyPaid, 50);
  assert.equal(three.remaining, 150);
});
