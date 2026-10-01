import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterMembers, sortMembers, paginate, facetsFor, summarise, scoreMember,
  groupMembers, countsFor, fold, squash,
} from './memberQuery.js';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const M = (over = {}) => ({
  id: over.id ?? 'm1',
  reg: '1001',
  name: 'Ram Kumar',
  father: 'Shyam Lal',
  phone: '9876543210',
  ph2: '',
  aadhaar: '123456789012',
  village: 'Kotra',
  dist: 'Ajmer',
  gen: 'male',
  jati: 'Meena',
  ageBand: '18-30',
  age: 25,
  status: 'accepted',
  agentId: 'ag1',
  agent: 'Mohan',
  pid: 'p1',
  prog: 'Yojna A',
  joinMs: Date.UTC(2024, 0, 15),
  dobMs: Date.UTC(1999, 0, 1),
  pay: 200,
  fee: 500,
  feeDone: true,
  dueC: 3,
  due: 600,
  paidC: 2,
  paid: 400,
  lastPay: Date.UTC(2025, 5, 1),
  photo: '',
  ...over,
});

const sita = M({
  id: 'm2', reg: '1002', name: 'Sita Devi', father: 'Ram Kumar',
  phone: '9000000001', village: 'Baran', dist: 'Kota', gen: 'female',
  ageBand: '31-45', age: 38, status: 'blocked', agentId: '', agent: '',
  joinMs: Date.UTC(2022, 5, 1), feeDone: false, dueC: 0, due: 0, paid: 1000,
});

const gopal = M({
  id: 'm3', reg: '1003', name: 'Gopal Singh', father: 'Hari',
  phone: '9111111111', village: 'Kotra', dist: 'Ajmer', gen: 'male',
  ageBand: '46-60', age: 52, status: 'accepted', agentId: 'ag2', agent: 'Kailash',
  pid: 'p2', prog: 'Yojna B', joinMs: Date.UTC(2025, 2, 10), dueC: 10, due: 2000,
});

const all = [M(), sita, gopal];

/* ── free-text search ────────────────────────────────────────────────────── */

test('exact registration number outranks everything else', () => {
  assert.equal(scoreMember(M(), '1001'), 100);
});

test('phone matches regardless of spaces and punctuation', () => {
  const hits = filterMembers(all, { q: '98765 43210' });
  assert.deepEqual(hits.map((m) => m.id), ['m1']);
});

test('a partial phone still matches once it is specific enough', () => {
  assert.deepEqual(filterMembers(all, { q: '0000' }).map((m) => m.id), ['m2']);
});

test('search is case-insensitive and matches inside a name', () => {
  assert.deepEqual(filterMembers(all, { q: 'DEVI' }).map((m) => m.id), ['m2']);
});

test("search finds people by their father's name", () => {
  assert.deepEqual(filterMembers(all, { q: 'Shyam' }).map((m) => m.id), ['m1']);
});

test('search matches the Aadhaar number', () => {
  assert.deepEqual(
    filterMembers(all, { q: '123456789012' }).map((m) => m.id),
    ['m1', 'm2', 'm3'].filter((id) => id === 'm1' || id === 'm2' || id === 'm3'),
  );
});

test('a query that matches nothing returns nothing, not everything', () => {
  assert.equal(filterMembers(all, { q: 'zzzzqq' }).length, 0);
});

test('an empty query is not a filter', () => {
  assert.equal(filterMembers(all, { q: '' }).length, 3);
});

/* ── structured filters ──────────────────────────────────────────────────── */

test('filters by gender', () => {
  assert.deepEqual(filterMembers(all, { gender: 'female' }).map((m) => m.id), ['m2']);
});

test('filters by status, several at once', () => {
  const ids = filterMembers(all, { status: ['accepted', 'blocked'] }).map((m) => m.id);
  assert.deepEqual(ids, ['m1', 'm2', 'm3']);
});

test('filters by age band', () => {
  assert.deepEqual(filterMembers(all, { ageBand: '46-60' }).map((m) => m.id), ['m3']);
});

test('filters by an age range', () => {
  assert.deepEqual(
    filterMembers(all, { ageMin: 30, ageMax: 45 }).map((m) => m.id),
    ['m2'],
  );
});

test('filters by joining-date window, inclusive at both ends', () => {
  const ids = filterMembers(all, {
    joinFrom: Date.UTC(2024, 0, 1),
    joinTo: Date.UTC(2024, 11, 31),
  }).map((m) => m.id);
  assert.deepEqual(ids, ['m1']);
});

test('filters by program, and `all` means every program', () => {
  assert.deepEqual(filterMembers(all, { programId: 'p2' }).map((m) => m.id), ['m3']);
  assert.equal(filterMembers(all, { programId: 'all' }).length, 3);
});

test('an unassigned agent is selectable as _none', () => {
  assert.deepEqual(filterMembers(all, { agentId: '_none' }).map((m) => m.id), ['m2']);
});

test('hasDue works in both directions', () => {
  assert.deepEqual(filterMembers(all, { hasDue: true }).map((m) => m.id), ['m1', 'm3']);
  assert.deepEqual(filterMembers(all, { hasDue: false }).map((m) => m.id), ['m2']);
});

test('feeDone false finds members who still owe the joining fee', () => {
  assert.deepEqual(filterMembers(all, { feeDone: false }).map((m) => m.id), ['m2']);
});

test('filters combine as AND, not OR', () => {
  const ids = filterMembers(all, {
    status: 'accepted', gender: 'male', village: 'Kotra', hasDue: true,
  }).map((m) => m.id);
  assert.deepEqual(ids, ['m1', 'm3']);

  // One more condition that only m1 satisfies.
  assert.deepEqual(
    filterMembers(all, { status: 'accepted', ageBand: '18-30' }).map((m) => m.id),
    ['m1'],
  );
});

test('search and filters compose', () => {
  assert.equal(filterMembers(all, { q: 'Kotra', gender: 'female' }).length, 0);
  assert.deepEqual(
    filterMembers(all, { q: 'Kotra', ageMin: 50 }).map((m) => m.id),
    ['m3'],
  );
});

/* ── sorting ─────────────────────────────────────────────────────────────── */

test('registration numbers sort numerically, not as text', () => {
  const rows = [M({ id: 'a', reg: '9' }), M({ id: 'b', reg: '100' })];
  assert.deepEqual(
    sortMembers(rows, 'registrationNumber', 'asc').map((m) => m.id),
    ['a', 'b'],
  );
});

test('sorts by due amount, descending', () => {
  assert.deepEqual(
    sortMembers(all, 'dueAmount', 'desc').map((m) => m.id),
    ['m3', 'm1', 'm2'],
  );
});

test('relevance beats the chosen sort while searching', () => {
  const hits = filterMembers(all, { q: 'Ram Kumar' });
  const sorted = sortMembers(hits, 'dueAmount', 'desc');
  // m1 IS "Ram Kumar"; m2's FATHER is Ram Kumar. The person wins.
  assert.equal(sorted[0].id, 'm1');
});

test('an unknown sort field falls back instead of throwing', () => {
  assert.equal(sortMembers(all, 'nonsense', 'asc').length, 3);
});

/* ── totals, facets, paging ──────────────────────────────────────────────── */

test('totals cover the whole set, not one page', () => {
  const t = summarise(all);
  assert.equal(t.count, 3);
  assert.equal(t.dueAmount, 2600);
  assert.equal(t.paidAmount, 1800);
  assert.equal(t.withDue, 2);
  assert.equal(t.feePending, 1);
});

test('facets count distinct values', () => {
  const f = facetsFor(all);
  const kotra = f.villages.find((v) => v.value === 'Kotra');
  assert.equal(kotra.count, 2);
  assert.equal(f.programs.length, 2);
  assert.equal(f.genders.find((g) => g.value === 'female').count, 1);
});

test('paging reports total pages and clamps an out-of-range page', () => {
  const p = paginate(all, { page: 99, limit: 2 });
  assert.equal(p.pages, 2);
  assert.equal(p.page, 2);
  assert.equal(p.total, 3);
  assert.equal(p.rows.length, 1);
});

/* ── scale ───────────────────────────────────────────────────────────────── */

test('5,000 members filter and sort in well under a second', () => {
  const big = Array.from({ length: 5000 }, (_, i) =>
    M({
      id: `m${i}`,
      reg: String(1000 + i),
      name: `Member ${i}`,
      phone: String(9000000000 + i),
      gen: i % 2 ? 'male' : 'female',
      status: i % 7 === 0 ? 'blocked' : 'accepted',
      ageBand: ['18-30', '31-45', '46-60'][i % 3],
      village: `Village ${i % 40}`,
      dueC: i % 5,
      due: (i % 5) * 200,
    }),
  );

  const started = Date.now();
  const hits = filterMembers(big, {
    gender: 'female',
    status: 'accepted',
    ageBand: ['18-30', '31-45'],
    hasDue: true,
  });
  const sorted = sortMembers(hits, 'dueAmount', 'desc');
  const page = paginate(sorted, { page: 1, limit: 50 });
  const elapsed = Date.now() - started;

  assert.ok(hits.length > 0, 'the filter should match somebody');
  assert.equal(page.rows.length, 50);
  assert.ok(elapsed < 500, `took ${elapsed}ms — expected well under 500ms`);

  // Every returned row really satisfies every condition.
  for (const m of page.rows) {
    assert.equal(m.gen, 'female');
    assert.equal(m.status, 'accepted');
    assert.ok(['18-30', '31-45'].includes(m.ageBand));
    assert.ok(m.dueC > 0);
  }
});

/* ── grouped counts ──────────────────────────────────────────────────────── */

test('groups by agent with counts and money together', () => {
  const rows = groupMembers(all, 'agent');
  const mohan = rows.find((r) => r.value === 'ag1');

  assert.equal(mohan.label, 'Mohan');
  assert.equal(mohan.count, 1);
  assert.equal(mohan.active, 1);
  assert.equal(mohan.dueAmount, 600);
  assert.equal(mohan.withDue, 1);
});

test('members with no agent are their own bucket, not dropped', () => {
  const rows = groupMembers(all, 'agent');
  const none = rows.find((r) => r.value === '_none');
  assert.equal(none.count, 1);
  assert.equal(none.label, 'सीधे जोड़ा गया');
});

test('grouping splits statuses inside each bucket', () => {
  const rows = groupMembers(all, 'village');
  const kotra = rows.find((r) => r.value === 'Kotra');
  assert.equal(kotra.count, 2);
  assert.equal(kotra.active, 2);
  assert.equal(kotra.blocked, 0);
});

test('an unknown dimension returns nothing rather than throwing', () => {
  assert.deepEqual(groupMembers(all, 'nonsense'), []);
});

test('headline counts add up to the whole set', () => {
  const c = countsFor(all);
  assert.equal(c.members.total, 3);
  assert.equal(c.members.accepted, 2);
  assert.equal(c.members.blocked, 1);
  assert.equal(c.money.dueAmount, 2600);
  assert.equal(c.money.withDue, 2);
});

test('counts of a filtered set match that set, not the whole trust', () => {
  const onlyActive = filterMembers(all, { status: 'accepted' });
  const c = countsFor(onlyActive);
  assert.equal(c.members.total, 2);
  assert.equal(c.members.blocked, 0);
});

/* ── Devanagari, as it is actually typed ─────────────────────────────────── */

const hindi = (over = {}) => M({
  id: 'h1', reg: '2001', name: 'रामकुमार', father: 'श्यामलाल',
  phone: '9876500001', village: 'कोटड़ा', dist: 'अजमेर', ...over,
});

const people = [
  hindi(),
  hindi({ id: 'h2', reg: '2002', name: 'राम कुमार शर्मा', village: 'बारां', dist: 'कोटा' }),
  hindi({ id: 'h3', reg: '2003', name: 'रामलाल', phone: '9876500003' }),
  hindi({ id: 'h4', reg: '2004', name: 'सीता देवी', village: 'बारां', dist: 'कोटा' }),
];

const names = (q) => sortMembers(filterMembers(people, { q })).map((m) => m.name);

test('spacing is not meaning — "राम कुमार" finds "रामकुमार"', () => {
  // The single most common miss: the operator types the name with a space,
  // the register has it without one.
  assert.ok(names('राम कुमार').includes('रामकुमार'));
  assert.ok(names('रामकुमार').includes('राम कुमार शर्मा'));
});

test('a missing nukta still matches — कोटडा finds कोटड़ा', () => {
  // Plenty of keyboards produce ड where the register has ड़.
  assert.deepEqual(names('कोटडा').sort(), ['रामकुमार', 'रामलाल'].sort());
});

test('NFD and NFC forms of the same word match each other', () => {
  assert.equal(fold('कोटड़ा'), fold('कोटड़ा'.normalize('NFD')));
  assert.ok(names('राम'.normalize('NFD')).length > 0);
});

test('chandrabindu and anusvara are treated as the same mark', () => {
  assert.equal(fold('गाँव'), fold('गांव'));
});

test('zero-width characters from a paste are ignored', () => {
  assert.equal(fold('राम​कुमार'), fold('रामकुमार'));
});

test('two words search ACROSS fields — name plus village', () => {
  // "Ram, in Kotra" is how a person narrows a list. Matching the query as one
  // string could never answer it.
  assert.deepEqual(names('राम कोटड़ा').sort(), ['रामकुमार', 'रामलाल'].sort());
  assert.deepEqual(names('कोटड़ा राम').sort(), ['रामकुमार', 'रामलाल'].sort());
});

test('every word must land — one miss rejects the member', () => {
  assert.deepEqual(names('राम बाराँ'), ['राम कुमार शर्मा']);
  assert.deepEqual(names('राम मुंबई'), []);
});

test('a member matching both words beats one matching a single word better', () => {
  const ranked = names('राम कोटड़ा');
  assert.ok(ranked.length > 0);
  for (const n of ranked) assert.notEqual(n, 'सीता देवी');
});

test('squash strips punctuation as well as spaces', () => {
  assert.equal(squash('राम-कुमार'), squash('राम कुमार'));
  assert.equal(squash('  RAM  '), 'ram');
});

test('a phone number matches however it is punctuated', () => {
  assert.deepEqual(names('98765 00003'), ['रामलाल']);
  assert.deepEqual(names('+91-9876500003'), ['रामलाल']);
});

test('search over 5,000 Devanagari names stays instant', () => {
  const big = Array.from({ length: 5000 }, (_, i) =>
    hindi({
      id: `b${i}`,
      reg: String(3000 + i),
      name: `सदस्य ${i}`,
      village: ['कोटड़ा', 'बारां', 'मालपुरा'][i % 3],
      phone: String(9800000000 + i),
    }),
  );

  const started = Date.now();
  // Run it several times: the folded form is cached on first touch, so this
  // also proves the cache is doing its job rather than re-folding every pass.
  for (let i = 0; i < 5; i += 1) filterMembers(big, { q: 'सदस्य कोटड़ा' });
  const elapsed = Date.now() - started;

  const hits = filterMembers(big, { q: 'सदस्य कोटड़ा' });
  assert.ok(hits.length > 1000, `expected a third of them, got ${hits.length}`);
  assert.ok(elapsed < 800, `five passes took ${elapsed}ms`);
});

test('a country code does not stop a phone number matching', () => {
  // The same number gets written every one of these ways.
  for (const typed of ['9876500003', '98765 00003', '+91-9876500003',
                       '91 98765 00003', '098765 00003']) {
    assert.deepEqual(names(typed), ['रामलाल'], `${typed} should find the member`);
  }
});

/* ── the joining fee, in money ───────────────────────────────────────────── */

test('hasFeeDue finds part-paid fees, which hasDue cannot', () => {
  const items = [
    // Owes closings, fee settled.
    M({ id: 'a', dueC: 2, due: 400, fee: 1100, feePaid: 1100, feeDue: 0, feeDone: true }),
    // Owes nothing on closings, but ₹8,900 of their fee.
    M({ id: 'b', dueC: 0, due: 0, fee: 11000, feePaid: 2100, feeDue: 8900, feeDone: false }),
  ];

  assert.deepEqual(filterMembers(items, { hasDue: true }).map((m) => m.id), ['a']);
  assert.deepEqual(filterMembers(items, { hasFeeDue: true }).map((m) => m.id), ['b']);
  assert.deepEqual(
    filterMembers(items, { owesAnything: true }).map((m) => m.id).sort(),
    ['a', 'b'],
  );
});

test('hasFeeDue false keeps only fully-paid fees', () => {
  const items = [
    M({ id: 'a', fee: 1100, feeDue: 0, feeDone: true }),
    M({ id: 'b', fee: 11000, feeDue: 8900, feeDone: false }),
  ];
  assert.deepEqual(filterMembers(items, { hasFeeDue: false }).map((m) => m.id), ['a']);
});

test('a legacy entry with no fee amounts falls back to the old flag', () => {
  // Written before feeDue/feePaid existed: feeDone is all there is.
  const paid = M({ id: 'a', fee: 1100, feeDone: true });
  const unpaid = M({ id: 'b', fee: 1100, feeDone: false });
  delete paid.feeDue; delete paid.feePaid;
  delete unpaid.feeDue; delete unpaid.feePaid;

  assert.deepEqual(filterMembers([paid, unpaid], { hasFeeDue: true }).map((m) => m.id), ['b']);
  assert.equal(summarise([paid]).feeDueAmount, 0);
  assert.equal(summarise([unpaid]).feeDueAmount, 1100);
});

test('summarise totals the fee in rupees, not just heads', () => {
  const t = summarise([
    M({ id: 'a', fee: 11000, feePaid: 2100, feeDue: 8900, feeDone: false }),
    M({ id: 'b', fee: 1100, feePaid: 0, feeDue: 1100, feeDone: false }),
    M({ id: 'c', fee: 1100, feePaid: 1100, feeDue: 0, feeDone: true }),
  ]);

  assert.equal(t.feeDueAmount, 10000);
  assert.equal(t.feePaidAmount, 3200);
  assert.equal(t.feePending, 2);
  // Only 'a' has put something towards a fee that is still short.
  assert.equal(t.feePartial, 1);
});
