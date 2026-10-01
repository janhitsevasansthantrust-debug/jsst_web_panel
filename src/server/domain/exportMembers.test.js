import test from 'node:test';
import assert from 'node:assert/strict';

import { toCsv, EXPORT_COLUMNS, cellValue } from './exportMembers.js';

const member = {
  id: 'm1',
  registrationNumber: '1001',
  displayName: 'रामकुमार',
  fatherName: 'श्यामलाल',
  gender: 'male',
  age: 25,
  ageGroupRange: '18-30',
  phone: '9876543210',
  village: 'कोटड़ा',
  district: 'अजमेर',
  status: 'accepted',
  programName: 'मुख्य योजना',
  agentName: 'मोहन',
  joinDateMs: Date.UTC(2024, 0, 15),
  payAmount: 200,
  dueCount: 3,
  dueAmount: 600,
  paidAmount: 400,
  joinFees: 500,
  joinFeesDone: true,
  aadhaarNo: '123456789012',
};

test('the file starts with a UTF-8 BOM', () => {
  // Without it Excel on Windows reads the file as the system code page and
  // every Hindi name opens as mojibake.
  assert.equal(toCsv([]).charCodeAt(0), 0xfeff);
});

test('header row carries every export column, in order', () => {
  const [header] = toCsv([]).replace('﻿', '').split('\r\n');
  assert.equal(header.split(',').length, EXPORT_COLUMNS.length);
  assert.ok(header.startsWith('रजि. नं.,नाम,'));
});

test('a member row keeps Hindi intact and maps coded values to labels', () => {
  const row = toCsv([member]).replace('﻿', '').split('\r\n')[1];
  assert.ok(row.includes('रामकुमार'));
  assert.ok(row.includes('पुरुष'), 'gender code should print as a word');
  assert.ok(row.includes('स्वीकृत'), 'status code should print as a word');
  assert.ok(row.includes('15-01-2024'), 'epoch ms should print as a date');
  assert.ok(row.includes('हाँ'), 'a boolean should print as a word');
});

test('a comma inside a value is quoted, not treated as a column break', () => {
  const row = toCsv([{ ...member, village: 'कोटड़ा, तहसील' }])
    .replace('﻿', '').split('\r\n')[1];
  assert.ok(row.includes('"कोटड़ा, तहसील"'));
});

test('a quote inside a value is doubled', () => {
  const row = toCsv([{ ...member, displayName: 'राम "बाबू"' }])
    .replace('﻿', '').split('\r\n')[1];
  assert.ok(row.includes('"राम ""बाबू"""'));
});

test('a newline inside a value does not split the row', () => {
  const csv = toCsv([{ ...member, village: 'ऊपर\nनीचे' }]).replace('﻿', '');
  // Header + one record + trailing newline. The embedded newline lives inside
  // quotes, so a CSV reader still sees exactly two lines.
  assert.equal(csv.split('\r\n').filter(Boolean).length, 2);
});

test('a value starting with = is neutralised so it cannot run as a formula', () => {
  // A member named "=cmd|..." is a CSV injection waiting to execute in
  // whoever opens the file.
  const row = toCsv([{ ...member, displayName: '=1+1' }])
    .replace('﻿', '').split('\r\n')[1];
  assert.ok(row.includes("'=1+1"), 'should be prefixed with an apostrophe');
  assert.ok(!row.includes(',=1+1,'), 'should never appear as a bare formula');
});

test('the same neutralising applies to + - @ and a leading tab', () => {
  for (const dangerous of ['+1', '-1', '@SUM(A1)', '\tx']) {
    const row = toCsv([{ ...member, displayName: dangerous }])
      .replace('﻿', '').split('\r\n')[1];
    assert.ok(row.includes(`'${dangerous}`) || row.includes(`"'${dangerous}`),
      `${JSON.stringify(dangerous)} should be escaped`);
  }
});

test('missing fields become empty cells rather than "undefined"', () => {
  const row = toCsv([{ id: 'x' }]).replace('﻿', '').split('\r\n')[1];
  assert.ok(!row.includes('undefined'));
  assert.ok(!row.includes('null'));
});

test('cellValue applies a column mapper, and passes raw values through', () => {
  const status = EXPORT_COLUMNS.find((c) => c.key === 'status');
  const name = EXPORT_COLUMNS.find((c) => c.key === 'displayName');
  assert.equal(cellValue(member, status), 'स्वीकृत');
  assert.equal(cellValue(member, name), 'रामकुमार');
});

test('an empty list still produces a usable file with headers', () => {
  const csv = toCsv([]).replace('﻿', '');
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
});

/* ── the whole server-side export path ───────────────────────────────────── */

import { filterMembers, sortMembers } from './memberQuery.js';
import { fromMemberEntry } from './indexEntry.js';

/**
 * The export is filter → sort → slice → CSV, over the same index entries the
 * list is served from. This walks that whole chain so a break anywhere in it
 * fails here rather than as an empty file someone notices a week later.
 */
const entry = (over = {}) => ({
  id: 'm1', reg: '1001', name: 'रामकुमार', father: 'श्यामलाल',
  phone: '9876543210', ph2: '', aadhaar: '123456789012',
  village: 'कोटड़ा', dist: 'अजमेर', gen: 'male', jati: 'मीणा',
  ageBand: '18-30', age: 25, status: 'accepted', agentId: 'ag1', agent: 'मोहन',
  pid: 'p1', prog: 'मुख्य योजना', joinMs: Date.UTC(2024, 0, 15),
  dobMs: Date.UTC(1999, 0, 1), pay: 200, fee: 500, feeDone: true,
  dueC: 3, due: 600, paidC: 2, paid: 400, lastPay: null, photo: '',
  ...over,
});

test('the export chain turns index entries into a filtered, sorted CSV', () => {
  const items = [
    entry(),
    entry({ id: 'm2', reg: '1002', name: 'सीता देवी', gen: 'female', dueC: 0, due: 0 }),
    entry({ id: 'm3', reg: '1003', name: 'गोपाल', pid: 'p2', due: 2000, dueC: 9 }),
  ];

  const filtered = filterMembers(items, { programId: 'p1' });
  const sorted = sortMembers(filtered, 'dueAmount', 'desc');
  const rows = sorted.map(fromMemberEntry);
  const csv = toCsv(rows).replace('﻿', '');
  const lines = csv.split('\r\n').filter(Boolean);

  assert.equal(lines.length, 3, 'header plus the two members in program p1');
  assert.ok(lines[1].includes('रामकुमार'), 'the bigger debtor sorts first');
  assert.ok(lines[2].includes('सीता देवी'));
  assert.ok(!csv.includes('गोपाल'), 'a member of another program must not appear');
});

test('an export of nothing is still a valid file, not a broken one', () => {
  const csv = toCsv([]).replace('﻿', '');
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
});

test('कुल जमा adds the joining fee to the closings total', () => {
  const col = EXPORT_COLUMNS.find((c) => c.key === 'totalPaid');
  assert.ok(col, 'the कुल जमा column exists');

  // A member who owes no closing but has part-paid their fee used to read ₹0.
  assert.equal(cellValue({ paidAmount: 0, joinFeesPaid: 2100 }, col), 2100);
  assert.equal(cellValue({ paidAmount: 800, joinFeesPaid: 2100 }, col), 2900);
  assert.equal(cellValue({ paidAmount: 800 }, col), 800);
  assert.equal(cellValue({}, col), 0);
});

test('the closings column is no longer labelled as everything', () => {
  const col = EXPORT_COLUMNS.find((c) => c.key === 'paidAmount');
  assert.equal(col.header, 'क्लोजिंग जमा');
});
