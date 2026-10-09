import test from 'node:test';
import assert from 'node:assert/strict';

import { MEMBER_INDEX_FIELDS, toMemberEntry, fromMemberEntry } from './indexEntry.js';
import { readLedger, computeDue } from './ledger.js';

/**
 * The member index is the contract between Firestore and every screen, and it
 * is written with two-letter keys. Anything dropped in that squeeze shows up as
 * a blank column — or worse, as a member who owes nothing because the field
 * that said they still owed it never made it into the index.
 *
 * The closing-date fields are the ones under test here. A member who is CLOSED
 * still owes every other member's closing up to and including their own closing
 * date, and that is decided entirely from the index. If `closingDateMs` is lost
 * in the round trip, every closed member silently stops owing anything.
 */

const member = {
  registrationNumber: 'V100151',
  displayName: 'रमेश कुमार',
  fatherName: 'श्री हरि प्रसाद',
  phone: '9876543210',
  village: 'सीहान',
  jati: 'ब्राह्मण',
  ageGroupRange: '46-60',
  age: 52,
  status: 'closed',
  agentId: 'a1',
  agentName: 'विकास',
  programId: 'p1',
  programName: 'मासिक',
  joinDateMs: Date.UTC(2024, 0, 10),
  bobDateMs: Date.UTC(1974, 3, 2),
  payAmount: 500,
  joinFees: 11000,
  joinFeesPaid: 2100,
  joinFeesDue: 8900,
  dueCount: 2,
  dueAmount: 1000,
  paidCount: 4,
  paidAmount: 2000,
  lastPaymentAt: Date.UTC(2026, 3, 5),
  photoURL: 'https://example.test/p.jpg',
  exitDateMs: Date.UTC(2026, 3, 5),
  exitReason: 'closed',
  closingDateMs: Date.UTC(2026, 3, 5),
  closingId: 'c9',
  paidUpTo: 12,
  paidSeqs: [14, 15],
  exemptSeqs: [13],
  partialPaid: { 16: 125 },
};

test('every listed field survives the squeeze, whatever its key is called', () => {
  // The keys are deliberately two letters, so the only way to prove nothing was
  // dropped in the renaming is to check the VALUE comes back. A field listed in
  // MEMBER_INDEX_FIELDS but missing from the mapping is a column that silently
  // reads as blank, or a member who appears to owe nothing.
  //
  // `joinFeesDone` is the one field that does not come back unchanged, on
  // purpose: the entry stores a boolean so that a member enrolled before the
  // amount was tracked is treated as having paid the whole fee.
  const normalised = { joinFeesDone: true };
  const full = Object.fromEntries(MEMBER_INDEX_FIELDS.map((f) => [f, `x-${f}`]));
  const back = fromMemberEntry(toMemberEntry('m1', full));
  const lost = MEMBER_INDEX_FIELDS.filter((f) => back[f] !== normalised[f] && back[f] !== full[f]);
  assert.deepEqual(lost, []);
});

test('a closed member’s date survives the round trip, so they still owe their instalments', () => {
  const back = fromMemberEntry(toMemberEntry('m1', member));

  assert.equal(back.closingDateMs, member.closingDateMs);
  assert.equal(back.exitDateMs, member.exitDateMs);
  assert.equal(back.exitReason, 'closed');
  assert.equal(back.closingId, 'c9');

  const closings = [
    { seq: 13, memberId: 'x', dateMs: Date.UTC(2026, 2, 20), status: 'active' },
    { seq: 14, memberId: 'x', dateMs: Date.UTC(2026, 3, 3), status: 'active' },
    { seq: 15, memberId: 'x', dateMs: Date.UTC(2026, 3, 4), status: 'active' },
    { seq: 16, memberId: 'x', dateMs: Date.UTC(2026, 3, 5), status: 'active' },
    { seq: 17, memberId: 'x', dateMs: Date.UTC(2026, 3, 6), status: 'active' },
  ];
  // 13 and 14 are settled and 15 is exempt, so the only thing left owing is the
  // part-paid 5th. The 6th is after the member closed and is not theirs.
  assert.deepEqual(computeDue(back, closings).dueSeqs, [16]);

  // With no ledger at all, the same dates decide it: everything up to and
  // including their own closing date, and nothing after it.
  const fresh = fromMemberEntry(toMemberEntry('m1', {
    ...member, paidUpTo: 0, paidSeqs: [], exemptSeqs: [], partialPaid: {},
  }));
  assert.deepEqual(computeDue(fresh, closings).dueSeqs, [13, 14, 15, 16]);
});

test('the ledger maps survive the round trip and normalise Firestore’s string keys', () => {
  const back = fromMemberEntry(toMemberEntry('m1', member));
  const ledger = readLedger(back);

  assert.equal(ledger.paidUpTo, 12);
  assert.deepEqual(ledger.paidSeqs, [14, 15]);
  assert.deepEqual(ledger.exemptSeqs, [13]);
  // Firestore turns map keys into strings on the way out. `readLedger` puts
  // them back, so a part-paid instalment is still found by its seq.
  assert.deepEqual(ledger.partialPaid, { 16: 125 });
  assert.deepEqual(readLedger(fromMemberEntry(toMemberEntry('m1', { ...member, partialPaid: { '16': '125' } }))).partialPaid,
    { 16: 125 });
});

test('a member with no ledger at all still round-trips to something usable', () => {
  const back = fromMemberEntry(toMemberEntry('m2', { programId: 'p1' }));
  assert.deepEqual(readLedger(back), { paidUpTo: 0, paidSeqs: [], exemptSeqs: [], partialPaid: {} });
  assert.equal(back.payAmount, 0);
  assert.equal(back.agentId, null);
  assert.equal(back.closingDateMs, null);
});
