import test from 'node:test';
import assert from 'node:assert/strict';

import {
  memberCreate, memberUpdate, agentUpdate, teamMemberUpdate, trustUpdate,
} from './schemas.js';

/**
 * These all guard one bug: a PATCH body that quietly grows fields the caller
 * never sent. `zod`'s `.partial()` keeps `.default()`, so a schema built that
 * way turns "I did not mention this" into "set this to empty" — and every
 * value it writes is a legal one, so nothing fails and nobody notices until a
 * member's address is gone.
 */

const injects = (schema, body) => {
  const out = schema.parse(body);
  return Object.keys(out).filter((k) => !(k in body));
};

test('memberUpdate sends only what it was given', () => {
  assert.deepEqual(injects(memberUpdate, { status: 'blocked' }), []);
  assert.deepEqual(injects(memberUpdate, { village: 'कोटड़ा' }), []);
  assert.deepEqual(
    injects(memberUpdate, { displayName: 'रामकुमार', phone: '9876543210' }),
    [],
  );
});

test('memberCreate still fills in its defaults', () => {
  // The patch schema must not have loosened the create schema it came from.
  const full = memberCreate.parse({
    programId: 'p1',
    displayName: 'राम',
    phone: '9876543210',
    bobDateMs: Date.UTC(1999, 0, 1),
    joinDateMs: Date.UTC(2024, 0, 1),
    photoURL: 'https://example.test/a.jpg',
  });

  assert.equal(full.jati, '');
  assert.deepEqual(full.extraDetails, []);
});

test('agentUpdate does not blank an address when switching an agent off', () => {
  // This is the exact call the agents grid makes.
  assert.deepEqual(agentUpdate.parse({ active: false }), { active: false });
});

test('agentUpdate accepts an email change — it is the login', () => {
  assert.deepEqual(agentUpdate.parse({ email: 'new@example.com' }), {
    email: 'new@example.com',
  });
});

test('agentUpdate refuses a password — that has its own endpoint', () => {
  const out = agentUpdate.parse({ displayName: 'मोहन', password: 'sneaky123' });
  assert.equal(out.password, undefined);
});

test('teamMemberUpdate sends only what it was given', () => {
  assert.deepEqual(injects(teamMemberUpdate, { active: false }), []);
  assert.deepEqual(injects(teamMemberUpdate, { role: 'operator' }), []);
});

test('trustUpdate can carry a single branding field without clearing the rest', () => {
  const out = trustUpdate.parse({ branding: { nameHi: 'श्री ट्रस्ट' } });
  assert.deepEqual(Object.keys(out.branding), ['nameHi']);
});

test('a bad value is still rejected — patching is not the same as trusting', () => {
  assert.throws(() => agentUpdate.parse({ email: 'not-an-email' }));
  assert.throws(() => agentUpdate.parse({ phone: '123' }));
  assert.throws(() => memberUpdate.parse({ displayName: 'x' }));
});
