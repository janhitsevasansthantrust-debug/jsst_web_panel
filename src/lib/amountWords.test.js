import test from 'node:test';
import assert from 'node:assert/strict';

import { amountInWords } from './amountWords.js';

test('zero is a word, not an empty string', () => {
  // A receipt reading "अक्षरे:  रुपये मात्र" looks tampered with.
  assert.equal(amountInWords(0), 'शून्य');
});

test('single digits and teens', () => {
  assert.equal(amountInWords(1), 'एक');
  assert.equal(amountInWords(9), 'नौ');
  assert.equal(amountInWords(11), 'ग्यारह');
  assert.equal(amountInWords(19), 'उन्नीस');
});

test('the awkward tens Hindi does not build from parts', () => {
  // These are not "chaar + bees" — each is its own word, which is why the
  // table is written out rather than composed from tens and units.
  assert.equal(amountInWords(24), 'चौबीस');
  assert.equal(amountInWords(49), 'उनचास');
  assert.equal(amountInWords(69), 'उनहत्तर');
  assert.equal(amountInWords(99), 'निन्यानवे');
});

test('hundreds', () => {
  assert.equal(amountInWords(100), 'एक सौ');
  assert.equal(amountInWords(250), 'दो सौ पचास');
});

test('Indian grouping — thousand, lakh, crore, not millions', () => {
  assert.equal(amountInWords(1000), 'एक हज़ार');
  assert.equal(amountInWords(100000), 'एक लाख');
  assert.equal(amountInWords(10000000), 'एक करोड़');
  assert.equal(amountInWords(1234567), 'बारह लाख चौंतीस हज़ार पाँच सौ सड़सठ');
});

test('realistic collection amounts', () => {
  assert.equal(amountInWords(4200), 'चार हज़ार दो सौ');
  assert.equal(amountInWords(12500), 'बारह हज़ार पाँच सौ');
});

test('paise are dropped, so the words agree with the figure beside them', () => {
  assert.equal(amountInWords(99.99), 'निन्यानवे');
  assert.equal(amountInWords(100.5), 'एक सौ');
});

test('a negative amount reads as its magnitude', () => {
  // A reversal is shown as one elsewhere; "minus" on a receipt is how a
  // refund gets misread as a payment.
  assert.equal(amountInWords(-500), 'पाँच सौ');
});

test('rubbish input does not produce a broken receipt', () => {
  for (const bad of [null, undefined, NaN, '', 'abc']) {
    assert.equal(amountInWords(bad), 'शून्य');
  }
});

test('every amount up to ten thousand produces clean words', () => {
  // The guard that matters: one gap in the table prints an empty line on a
  // real receipt, and nobody checks ten thousand numbers by hand.
  for (let n = 1; n <= 10000; n += 1) {
    const words = amountInWords(n);
    assert.ok(words.length > 0, `${n} produced nothing`);
    assert.ok(!words.includes('undefined'), `${n} → ${words}`);
    assert.ok(!/\s{2,}/.test(words), `${n} → "${words}" has a gap`);
  }
});
