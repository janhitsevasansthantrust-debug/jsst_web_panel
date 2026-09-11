import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toSearchRow, fromSearchRow, searchEntries, SEARCH_ROW, fold,
} from './memberSearch.js';

/**
 * The compact rows the browser searches.
 *
 * Two things must hold or local search silently differs from server search:
 * the round trip through the positional row must preserve every field the
 * scorer reads, and searching the compact rows must rank the same as
 * searching the full entries.
 */

const entry = (over = {}) => ({
  id: 'm1', reg: '1001', name: 'रामकुमार', father: 'श्यामलाल',
  phone: '9876543210', ph2: '', aadhaar: '123456789012',
  village: 'कोटड़ा', dist: 'अजमेर', agent: 'मोहन', jati: 'मीणा',
  prog: 'मुख्य योजना', status: 'accepted', due: 600, ...over,
});

test('a row survives the round trip with every searchable field intact', () => {
  const back = fromSearchRow(toSearchRow(entry()));

  assert.equal(back.id, 'm1');
  assert.equal(back.reg, '1001');
  assert.equal(back.name, 'रामकुमार');
  assert.equal(back.father, 'श्यामलाल');
  assert.equal(back.phone, '9876543210');
  assert.equal(back.village, 'कोटड़ा');
  assert.equal(back.status, 'accepted');
  assert.equal(back.due, 600);
});

test('the row is positional and its length matches the declared shape', () => {
  // A row that grows without SEARCH_ROW growing is a field nobody can name.
  assert.equal(toSearchRow(entry()).length, SEARCH_ROW.length);
});

test('fields the compact row drops are present and empty, never undefined', () => {
  // The scorer reads them; `undefined.includes` is not a search result.
  const back = fromSearchRow(toSearchRow(entry()));
  for (const key of ['ph2', 'aadhaar', 'dist', 'agent', 'jati', 'prog']) {
    assert.equal(back[key], '', `${key} should be an empty string`);
  }
});

test('searching compact rows finds the same people as the full entries', () => {
  const people = [
    entry(),
    entry({ id: 'm2', reg: '1002', name: 'राम कुमार शर्मा', village: 'बारां' }),
    entry({ id: 'm3', reg: '1003', name: 'सीता देवी', village: 'बारां' }),
  ];
  const compact = people.map((p) => fromSearchRow(toSearchRow(p)));

  for (const q of ['राम', 'राम कुमार', '1002', '9876543210', 'कोटडा']) {
    assert.deepEqual(
      searchEntries(compact, q).map((m) => m.id),
      searchEntries(people, q).map((m) => m.id),
      `"${q}" should rank the same locally as it does on the server`,
    );
  }
});

test('a village-only search still works after the round trip', () => {
  const compact = [entry(), entry({ id: 'm2', village: 'बारां' })]
    .map((p) => fromSearchRow(toSearchRow(p)));
  assert.deepEqual(searchEntries(compact, 'कोटड़ा').map((m) => m.id), ['m1']);
});

test('an empty query returns nothing rather than everyone', () => {
  assert.deepEqual(searchEntries([entry()], ''), []);
  assert.deepEqual(searchEntries([entry()], '   '), []);
});

test('the limit is respected', () => {
  const many = Array.from({ length: 100 }, (_, i) =>
    entry({ id: `m${i}`, reg: String(2000 + i), name: `सदस्य ${i}` }),
  );
  assert.equal(searchEntries(many, 'सदस्य', { limit: 5 }).length, 5);
});

test('5,000 compact rows search in the time between two keystrokes', () => {
  const many = Array.from({ length: 5000 }, (_, i) =>
    fromSearchRow(toSearchRow(entry({
      id: `m${i}`,
      reg: String(2000 + i),
      name: `सदस्य ${i}`,
      phone: String(9800000000 + i),
      village: ['कोटड़ा', 'बारां', 'मालपुरा'][i % 3],
    }))),
  );

  const started = Date.now();
  // Ten keystrokes' worth.
  for (const q of ['स', 'सद', 'सदस', 'सदस्', 'सदस्य', 'सदस्य ', 'सदस्य 1',
                   'सदस्य 12', 'सदस्य 123', 'सदस्य 1234']) {
    searchEntries(many, q);
  }
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1000, `ten keystrokes took ${elapsed}ms across 5,000 members`);
  assert.equal(fold('सदस्य'), fold('सदस्य'.normalize('NFD')));
});
