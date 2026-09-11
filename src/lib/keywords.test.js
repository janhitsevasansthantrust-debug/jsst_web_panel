import test from 'node:test';
import assert from 'node:assert/strict';

import { memberKeywords, MAX_KEYWORDS } from './memberSearch.js';

const member = {
  displayName: 'श्रीमती कुसुमलता देवी घांची',
  fatherName: 'स्व. रामेश्वरलाल घांची',
  guardian: 'महेन्द्र कुमार',
  jati: 'घांची',
  gotra: 'चौहान',
  village: 'बाड़मेर',
  district: 'बाड़मेर',
  state: 'राजस्थान',
  agentName: 'भागीरथ कुमार',
  phone: '+91 94628 60053',
  phoneAlt: '9414100127',
  aadhaarNo: '1234 5678 9012',
  registrationNumber: 'RJ-001042',
  pinCode: '344001',
};

const keywords = memberKeywords(member);
const has = (t) => keywords.includes(t);

test('finds a member by any word of their name', () => {
  assert.ok(has('कुसुमलता'));
  assert.ok(has('घांची'));
  // …and by the whole name typed without spaces, which is how half of these
  // are entered.
  assert.ok(has('श्रीमतीकुसुमलतादेवीघांची'));
});

test('finds a member by their father, guardian, village and agent', () => {
  assert.ok(has('रामेश्वरलाल'));
  assert.ok(has('महेन्द्र'));
  assert.ok(has('भागीरथ'));
  // Stored FOLDED: the nukta is normalised away, so बाड़मेर is kept as
  // बाडमेर. That is the whole point — both spellings reach the same token.
  assert.ok(has('बाडमेर'));
});

test('phone numbers are stored as the last ten digits', () => {
  // The number was entered with a country code and spaces. Someone searching
  // types the plain ten digits, and must still find them.
  assert.ok(has('9462860053'));
  assert.ok(has('9414100127'));
  // And by the last four, which is what people read off a form.
  assert.ok(has('0053'));
});

test('आधार is searchable in full and by its last four digits', () => {
  assert.ok(has('123456789012'));
  assert.ok(has('9012'));
});

test('the registration number is searchable as written and as digits', () => {
  assert.ok(has('rj001042'), 'as printed on the receipt');
  assert.ok(has('1042'), 'as read aloud, without the prefix or padding');
});

test('folding survives the ways these words are actually typed', () => {
  // बाड़मेर written without the nukta — a different byte sequence, the same
  // place. Both must land on the same token.
  const other = memberKeywords({ ...member, village: 'बाडमेर' });
  assert.ok(other.includes('बाडमेर'));
  assert.equal(keywords.includes('बाडमेर'), true);
});

test('nothing useless gets stored', () => {
  const sparse = memberKeywords({ displayName: 'क', phone: '123' });
  // A single character matches half the trust, and a three-digit "phone" is
  // a typo rather than a number.
  assert.deepEqual(sparse, []);
});

test('an empty member does not throw', () => {
  assert.deepEqual(memberKeywords(), []);
  assert.deepEqual(memberKeywords({}), []);
});

test('the array is bounded, whatever is typed into the address field', () => {
  const wordy = memberKeywords({
    ...member,
    currentAddress: Array.from({ length: 200 }, (_, i) => `पता${i}`).join(' '),
  });
  assert.ok(wordy.length <= MAX_KEYWORDS, `${wordy.length} tokens`);
});

test('no duplicates — village and district are often the same word', () => {
  assert.equal(new Set(keywords).size, keywords.length);
});
