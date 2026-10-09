import test from 'node:test';
import assert from 'node:assert/strict';

import { toCsv, PAYMENT_EXPORT_COLUMNS, cellValue } from './exportPayments.js';

/** A receipt as `postOneReceipt` writes it. */
const receipt = (over = {}) => ({
  id: 'r1',
  receiptNo: 'RCPT/2026/00123',
  memberId: 'm1',
  memberSnapshot: {
    name: 'रामकुमार',
    regNo: '1001',
    fatherName: 'श्यामलाल',
    village: 'कोटड़ा',
    phone: '9876543210',
  },
  collectedByAgentId: 'a1',
  collectedByAgentName: 'Lalit kumar',
  paidAtMs: Date.UTC(2026, 8, 15, 6, 30),
  method: 'cash',
  reference: '',
  note: '',
  itemCount: 2,
  closingAmount: 400,
  joinFeeAmount: 100,
  totalAmount: 500,
  status: 'completed',
  groupCode: 'OCTOBE',
  items: [{ seq: 7 }],
  ...over,
});

test('the file starts with a UTF-8 BOM', () => {
  // Without it Excel on Windows reads the file as the system code page and
  // every Hindi name opens as mojibake — and a receipt register is mostly
  // Hindi names.
  assert.equal(toCsv([]).charCodeAt(0), 0xfeff);
});

test('header row carries every export column, in order', () => {
  const [header] = toCsv([]).replace('﻿', '').split('\r\n');
  assert.equal(header, PAYMENT_EXPORT_COLUMNS.map((c) => c.header).join(','));
});

test('a note that would execute as a formula is neutralised', () => {
  // A receipt whose note begins with `=` is otherwise a CSV injection waiting
  // to run in whichever spreadsheet opens the file.
  const csv = toCsv([receipt({ note: '=1+1' })]);
  assert.ok(csv.includes("'=1+1"), 'expected the leading = to be quoted away');

  const plus = toCsv([receipt({ note: '+91 9876543210' })]);
  assert.ok(plus.includes("'+91 9876543210"));
});

test('a village containing a comma stays one column', () => {
  const csv = toCsv([
    receipt({ memberSnapshot: { ...receipt().memberSnapshot, village: 'कोटड़ा, तहसील' } }),
  ]);
  assert.ok(csv.includes('"कोटड़ा, तहसील"'), 'expected the comma-bearing value to be quoted');
});

test('one row per receipt, CRLF separated, and nothing else', () => {
  const csv = toCsv([receipt(), receipt({ receiptNo: 'RCPT/2026/00124' })]);
  const lines = csv.replace('﻿', '').split('\r\n');
  // header + two rows + the trailing CRLF, which yields a final empty element.
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '');
});

test('labels, not codes: a file says नकद, not cash', () => {
  // The screen says "नकद". A file that says "cash" is a second opinion about
  // the same fact, and the two must not drift apart.
  assert.equal(cellValue(receipt({ method: 'upi' }), byKey('method')), 'UPI');
  assert.equal(cellValue(receipt({ method: 'cash' }), byKey('method')), 'नकद');
  assert.equal(cellValue(receipt({ status: 'cancelled' }), byKey('status')), 'रद्द');
});

test('the payment date is written the way an office writes a date', () => {
  const value = cellValue(receipt(), byKey('paidDate'));
  assert.match(value, /^\d{1,2}-\d{1,2}-\d{4}$/);
});

test('computed columns fall back to the field when there is no value fn', () => {
  assert.equal(cellValue(receipt(), byKey('totalAmount')), 500);
  assert.equal(cellValue(receipt({ totalAmount: undefined }), byKey('totalAmount')), '');
});

test('every column has a Hindi header', () => {
  for (const col of PAYMENT_EXPORT_COLUMNS) {
    assert.ok(/[\u0900-\u097F]/.test(col.header), `header for ${col.key} is not Devanagari`);
  }
});

const byKey = (key) => PAYMENT_EXPORT_COLUMNS.find((c) => c.key === key);
