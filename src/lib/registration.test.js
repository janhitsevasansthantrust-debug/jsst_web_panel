import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRegistrationConfig, formatRegistration, nextSequential,
  randomRegistrationNumber, previewRegistration, REGISTRATION_MODE,
  DEFAULT_REGISTRATION,
} from './registration.js';

const cfg = (over) => resolveRegistrationConfig({ registration: over });

test('a program with no setting counts up from the default start', () => {
  const c = cfg(undefined);
  assert.equal(c.mode, REGISTRATION_MODE.SEQUENTIAL);
  assert.equal(c.startFrom, DEFAULT_REGISTRATION.startFrom);
  assert.equal(formatRegistration(c, 1001), '1001');
});

test('a prefix and padding shape the number', () => {
  const c = cfg({ prefix: 'RJ-', padding: 6 });
  assert.equal(formatRegistration(c, 1001), 'RJ-001001');
  assert.equal(formatRegistration(c, 123456), 'RJ-123456');
});

test('a suffix goes on the end, padding only touches the digits', () => {
  const c = cfg({ prefix: 'M', suffix: '/24', padding: 4 });
  assert.equal(formatRegistration(c, 7), 'M0007/24');
});

test('no padding leaves the number as it is', () => {
  assert.equal(formatRegistration(cfg({ padding: 0 }), 42), '42');
});

test('the counter holds the LAST issued number', () => {
  const c = cfg({ startFrom: 1001 });
  // Seeded to 1000, the first member gets 1001.
  assert.equal(nextSequential(c, 1000), 1001);
  assert.equal(nextSequential(c, 1001), 1002);
});

test('an unset counter starts at startFrom, not at one past it', () => {
  const c = cfg({ startFrom: 5000 });
  assert.equal(nextSequential(c, undefined), 5000);
  assert.equal(nextSequential(c, null), 5000);
});

test('raising startFrom later jumps forward, never re-issues', () => {
  // Numbers 1001–1050 are already printed on receipts. Someone then sets the
  // start to 2000; the next member must not be handed 1051.
  const c = cfg({ startFrom: 2000 });
  assert.equal(nextSequential(c, 1050), 2000);
  // And once past it, it simply carries on.
  assert.equal(nextSequential(c, 2010), 2011);
});

test('random numbers have the requested length and never lead with zero', () => {
  const c = cfg({ mode: 'random', randomLength: 6, prefix: 'RJ-' });
  for (let i = 0; i < 200; i += 1) {
    const n = randomRegistrationNumber(c);
    assert.ok(n.startsWith('RJ-'), n);
    const digits = n.slice(3);
    assert.equal(digits.length, 6, n);
    assert.notEqual(digits[0], '0', `${n} would read differently to a spreadsheet`);
    assert.ok(/^\d+$/.test(digits), n);
  }
});

test('random uses the supplied source, so it can be pinned in a test', () => {
  const c = cfg({ mode: 'random', randomLength: 4 });
  assert.equal(randomRegistrationNumber(c, () => 0), '1000');
  assert.equal(randomRegistrationNumber(c, () => 0.9999), '9999');
});

test('nonsense settings fall back instead of producing a broken number', () => {
  const c = cfg({ startFrom: 'abc', padding: -5, randomLength: 999, mode: 'weird' });
  assert.equal(c.mode, REGISTRATION_MODE.SEQUENTIAL);
  assert.equal(c.startFrom, DEFAULT_REGISTRATION.startFrom);
  assert.equal(c.padding, 0);
  assert.equal(c.randomLength, 12);
});

test('the preview shows what the next few members will actually get', () => {
  assert.deepEqual(
    previewRegistration({ prefix: 'RJ-', startFrom: 1001, padding: 5 }, 3),
    ['RJ-01001', 'RJ-01002', 'RJ-01003'],
  );

  const random = previewRegistration({ mode: 'random', prefix: 'X', randomLength: 5 }, 3);
  assert.equal(random.length, 3);
  for (const n of random) assert.match(n, /^X\d{5}$/);
});
