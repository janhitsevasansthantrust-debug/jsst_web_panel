/**
 * Matching a person by what someone typed.
 *
 * In `lib/` because BOTH sides run it: the server searches the index it holds
 * in memory, and the browser searches a compact copy of that index so typing
 * costs nothing at all. One implementation, or the two would drift and the
 * same query would give different answers depending on where it ran.
 *
 * Pure string work — no Firestore, no React, no imports.
 */

/* ── free text ───────────────────────────────────────────────────────────── */

/**
 * Why there are no `search_keywords` on the member document.
 *
 * The old system wrote 200+ prefix tokens into every member on every save, and
 * queried them one Firestore lookup per keystroke. That is expensive twice
 * over — on write and on read — and it still only ever matched PREFIXES of
 * single words, which is the weakest kind of match there is.
 *
 * Searching in memory over the index is both cheaper and better: it costs
 * nothing on write, about ten reads on read (zero while warm), and it can do
 * things a prefix array structurally cannot — match inside a word, match
 * across several fields at once, tolerate spelling variants, and rank results.
 *
 * The work that used to be spread across every write happens once, here.
 */

/**
 * Devanagari, flattened to what someone MEANT to type.
 *
 * Four things go wrong when a Hindi name is typed rather than copied:
 *
 *  • **Nukta.** `ड़` can arrive as one character (U+095C) or as `ड` + `़`, and
 *    plenty of people just type `ड`. `कोटड़ा` and `कोटडा` are the same village.
 *  • **Normalisation.** The same word can be NFC or NFD depending on the
 *    keyboard, and the two are different strings to `includes()`.
 *  • **Anusvara.** `ं` and `ँ` are used interchangeably in names.
 *  • **Zero-width joiners** ride along invisibly from copy-paste.
 *
 * None of this is exotic — it is what an operator's phone keyboard produces on
 * an ordinary Tuesday. Folding it away costs one pass and turns a search that
 * "does not work" into one that does.
 */
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')                    // split nukta and matras off
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width joiners
    .replace(/\u093C/g, '')              // the nukta itself: ड़ → ड, ज़ → ज
    .replace(/\u0901/g, '\u0902')        // chandrabindu ँ → anusvara ं
    .normalize('NFC')
    .toLowerCase()
    .trim();
}

/**
 * Folded AND stripped of everything but letters, digits and combining marks.
 *
 * `\p{M}` is the part that is easy to get wrong and expensive to get wrong.
 * Devanagari vowel signs — the ा in राम, the ु in कुमार — are Unicode MARKS,
 * not letters, so a regex that keeps only `\p{L}` and `\p{N}` deletes them.
 * "कुसुमलता" comes out as "कसमलत", and every name that differs only in its
 * matras collapses onto the same token: राम, रम and रमा become one word.
 *
 * Both sides of a comparison were being mangled identically, so search still
 * returned results and nothing looked broken — it was just far blunter than it
 * appeared, which is the kind of bug that never gets reported.
 */
export function squash(value) {
  return fold(value).replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

/**
 * Split folded text into words, on anything that is not part of a word.
 *
 * Same trap as `squash`: splitting on `[^\p{L}\p{N}]` breaks INSIDE every
 * Devanagari word, at each matra.
 */
export function words(value) {
  return fold(value)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean);
}

/** Digits only — spaces, dashes and brackets carry no meaning in a number. */
export const digits = (v) => String(v ?? '').replace(/\D+/g, '');

/**
 * A phone number reduced to what identifies it.
 *
 * Indian mobile numbers are ten digits, but they get written with a country
 * code as often as not — `+91 98765 43210`, `919876543210`, `09876543210`.
 * Comparing the last ten digits makes all of those the same number, which is
 * what the person searching means.
 */
export const phoneKey = (v) => {
  const d = digits(v);
  return d.length > 10 ? d.slice(-10) : d;
};

const norm = fold;

/**
 * The searchable text of one member, computed once.
 *
 * Folding six fields for 5,000 members on every keystroke would be wasted
 * work, and the index array is the same object between requests while the
 * cache is warm — so the folded form is attached to the entry the first time
 * it is needed and reused after that.
 */
function haystack(entry) {
  if (entry.__fold) return entry.__fold;

  const words = [
    entry.name, entry.father, entry.village, entry.dist,
    entry.agent, entry.jati, entry.prog, entry.reg,
  ];

  const built = {
    text: words.map(fold).filter(Boolean),
    squashed: words.map(squash).filter(Boolean),
    reg: fold(entry.reg),
    name: fold(entry.name),
    father: fold(entry.father),
    phones: [phoneKey(entry.phone), phoneKey(entry.ph2)].filter(Boolean),
    aadhaar: digits(entry.aadhaar),
  };

  // Non-enumerable so it never reaches a response body or a CSV.
  Object.defineProperty(entry, '__fold', { value: built, enumerable: false });
  return built;
}

/**
 * How well one member matches ONE word of the query.
 *
 * Ranking matters more than it looks: someone typing a registration number
 * wants that member first, not the twelve members whose phone number happens
 * to contain those digits.
 */
function scoreToken(hay, token) {
  const d = digits(token);
  const phone = phoneKey(token);
  const sq = squash(token);

  if (hay.reg === token || hay.reg === sq) return 100;
  if (phone && hay.phones.includes(phone)) return 98;
  if (d && d.length >= 8 && hay.aadhaar === d) return 96;

  if (hay.reg.startsWith(token)) return 85;
  if (hay.name.startsWith(token)) return 80;
  if (d && d.length >= 4 && hay.phones.some((p) => p.includes(d))) return 70;
  if (hay.name.includes(token)) return 60;
  if (hay.father.startsWith(token)) return 50;

  // Spacing is not meaning: "राम कुमार" must find "रामकुमार".
  if (sq && hay.squashed.some((f) => f.includes(sq))) return 45;
  if (hay.text.some((f) => f.includes(token))) return 35;
  if (d && d.length >= 6 && hay.aadhaar.includes(d)) return 10;

  return 0;
}

/**
 * How well one member matches the whole query.
 *
 * A multi-word query is an AND across fields, not a phrase: typing
 * "राम कोटड़ा" means "someone called Ram, in Kotra" — which is exactly how
 * people narrow down a list, and exactly what matching the query as one string
 * could never do.
 */
export function scoreMember(entry, query) {
  const q = fold(query);
  if (!q) return 1;

  const hay = haystack(entry);

  // The whole query as typed, before splitting — an exact registration number
  // or a full name with spaces should win outright.
  const whole = scoreToken(hay, q);
  if (whole >= 80) return whole;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return whole;

  let total = 0;
  for (const token of tokens) {
    const score = scoreToken(hay, token);
    // Every word must land somewhere, or this is not the member.
    if (score === 0) return 0;
    total += score;
  }

  // Averaged, then nudged up: a member matching two words is a better answer
  // than one matching a single word slightly better.
  return Math.min(99, total / tokens.length + 6);
}

/* ── searching a list ────────────────────────────────────────────────────── */

/**
 * The rows that go to the browser for instant search.
 *
 * A positional array, not an object, and only what a result row needs to be
 * found and recognised. At 5,000 members the difference between this and the
 * full index entry is roughly 1.7 MB and 350 KB — which on a phone in a
 * village is the difference between "instant" and "why is this app so slow".
 */
export const SEARCH_ROW = [
  'id', 'reg', 'name', 'father', 'phone', 'village', 'status', 'due',
];

/** Index entry → the compact positional row. */
export function toSearchRow(entry) {
  return [
    entry.id, entry.reg ?? '', entry.name ?? '', entry.father ?? '',
    entry.phone ?? '', entry.village ?? '', entry.status ?? '',
    // The outstanding amount rides along: at a collection counter, "which
    // Ram" is usually settled by who owes what, and four bytes is cheaper
    // than a second request per candidate.
    entry.due ?? 0,
  ];
}

/** Compact row → the shape `scoreMember` and the UI expect. */
export function fromSearchRow(row) {
  return {
    id: row[0], reg: row[1], name: row[2], father: row[3],
    phone: row[4], village: row[5], status: row[6], due: row[7] ?? 0,
    // Fields the compact row does not carry. Present and empty so the scorer
    // never has to guard for them.
    ph2: '', aadhaar: '', dist: '', agent: '', jati: '', prog: '',
  };
}

/**
 * Rank a list of members against a query.
 *
 * Shared by the server's index search and the browser's local one, so a query
 * typed in the box and the same query sent to an API return the same people in
 * the same order.
 */
export function searchEntries(entries, query, { limit = 20 } = {}) {
  const q = fold(query);
  if (q.length < 1) return [];

  const hits = [];

  for (const entry of entries) {
    const score = scoreMember(entry, q);
    if (score > 0) hits.push({ entry, score });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.entry.name ?? '').localeCompare(String(b.entry.name ?? '')),
  );

  return hits.slice(0, limit).map((h) => h.entry);
}

/* ══════════════════════════════════════════════════════════════════════════
   Keywords stored ON the member document
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The text fields a member can be found by.
 *
 * Order does not matter — the result is a set — but the list does: a field
 * that is captured on the form and missing here is a field an operator will
 * type into the search box and get nothing back from, which reads as "search
 * is broken" rather than "that field is not searchable".
 */
export const KEYWORD_TEXT_FIELDS = [
  'displayName',
  'fatherName',
  'guardian',
  'guardianRelation',
  'jati',
  'gotra',
  'gender',
  'village',
  'district',
  'state',
  'currentAddress',
  'agentName',
  'programName',
  'locationGroup',
  'ageGroupRange',
];

/**
 * A hard cap on how many tokens a member document carries.
 *
 * Firestore caps a document at 1 MB, and an unbounded array built from a long
 * address is how a member becomes unsaveable months after being added. Sixty
 * covers every real record with room to spare.
 */
export const MAX_KEYWORDS = 60;

/**
 * Everything one member can be searched by, as an array of exact tokens.
 *
 * Why this exists when there is already a trust-wide search index: the index
 * is the fast path for typing in the search box — it is one cached array in
 * memory and it ranks partial matches. These keywords are the other half:
 * they live ON the member, so `where('searchKeywords', 'array-contains', …)`
 * finds a person by phone, आधार or registration number with a single query and
 * no index load at all. That is what a "find this exact person" lookup wants —
 * a duplicate check before enrolment, a payment being posted against a number
 * read off a receipt — and it keeps working when the index is cold, being
 * rebuilt, or behind by a write.
 *
 * Tokens are WHOLE words, folded. No prefixes: storing every prefix of every
 * word multiplies the array by the average word length for the sake of a
 * partial match the in-memory index already does better.
 *
 * Numbers get both their full and their last-four form, because people read
 * the last four digits of a phone or an आधार off a form and search for that.
 */
export function memberKeywords(member = {}) {
  const out = new Set();

  const add = (value) => {
    const token = squash(value);
    // One character matches half the trust; more than 40 is an address that
    // was pasted into a name field.
    if (token.length >= 2 && token.length <= 40) out.add(token);
  };

  for (const field of KEYWORD_TEXT_FIELDS) {
    const folded = fold(member[field]);
    if (!folded) continue;

    // The whole value as one token — "राम कुमार" is findable as "रामकुमार",
    // which is how half of these names are typed.
    add(folded);

    for (const word of words(folded)) add(word);
  }

  /* ── numbers ─────────────────────────────────────────────────────────── */

  for (const value of [member.phone, member.phoneAlt]) {
    const key = phoneKey(value);
    if (key.length >= 6) {
      out.add(key);
      out.add(key.slice(-4));
    }
  }

  const aadhaar = digits(member.aadhaarNo);
  if (aadhaar.length === 12) {
    out.add(aadhaar);
    out.add(aadhaar.slice(-4));
  }

  // The registration number both as written (`RJ-001001`) and as bare digits,
  // because it is read aloud one way and typed the other.
  const reg = member.registrationNumber;
  add(reg);
  const regDigits = digits(reg);
  if (regDigits.length >= 2) out.add(regDigits.replace(/^0+/, '') || regDigits);

  const pin = digits(member.pinCode);
  if (pin.length === 6) out.add(pin);

  return [...out].slice(0, MAX_KEYWORDS);
}
