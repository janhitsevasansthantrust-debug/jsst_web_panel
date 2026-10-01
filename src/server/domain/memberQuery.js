import { fold, digits, scoreMember } from '../../lib/memberSearch.js';

// Re-exported so callers keep one import for "querying members".
export { fold, squash, digits, phoneKey, scoreMember } from '../../lib/memberSearch.js';

/**
 * Filtering, sorting and faceting over the member index.
 *
 * Pure functions on plain arrays — no Firestore, no network, no `scope`. That
 * is deliberate: this is the code that decides which members a user sees, and
 * it is the code most likely to be changed under time pressure, so it must be
 * testable without a database.
 *
 * The whole approach rests on one decision: the trust's members are already in
 * memory, in the index shards, for about ten reads. Once they are, a filter is
 * a loop. Doing the same work in Firestore would need a composite index for
 * every combination of filters a user might pick — status × gender × age band ×
 * agent × village × date range is hundreds of indexes — and would still not be
 * able to do free-text search or a case-insensitive contains.
 */

/* ── filters ─────────────────────────────────────────────────────────────── */

/** `undefined`, `null`, `''` and `'all'` all mean "do not filter on this". */
const unset = (v) => v === undefined || v === null || v === '' || v === 'all';

/**
 * Apply every filter at once.
 *
 * Each member is visited once and dropped at the first failing test, so cost
 * is linear in the number of members regardless of how many filters are on.
 */
export function filterMembers(items, filters = {}) {
  const q = fold(filters.q);
  const statuses = toSet(filters.status);
  const genders = toSet(filters.gender);
  const bands = toSet(filters.ageBand);
  const programs = toSet(filters.programId);
  const agents = toSet(filters.agentId);
  const villages = toSet(filters.village);
  const districts = toSet(filters.district);

  const joinFrom = numOrNull(filters.joinFrom);
  const joinTo = numOrNull(filters.joinTo);
  const ageMin = numOrNull(filters.ageMin);
  const ageMax = numOrNull(filters.ageMax);
  const minDue = numOrNull(filters.minDue);

  const out = [];

  for (const m of items) {
    if (statuses && !statuses.has(m.status)) continue;
    if (genders && !genders.has(fold(m.gen))) continue;
    if (bands && !bands.has(m.ageBand)) continue;
    if (programs && !programs.has(m.pid)) continue;
    if (agents && !agents.has(m.agentId ?? '')) continue;
    if (villages && !villages.has(m.village)) continue;
    if (districts && !districts.has(m.dist)) continue;

    if (joinFrom != null && !(Number(m.joinMs) >= joinFrom)) continue;
    if (joinTo != null && !(Number(m.joinMs) <= joinTo)) continue;

    if (ageMin != null && !(Number(m.age) >= ageMin)) continue;
    if (ageMax != null && !(Number(m.age) <= ageMax)) continue;

    if (filters.hasDue === true && !((m.dueC ?? 0) > 0)) continue;
    if (filters.hasDue === false && (m.dueC ?? 0) > 0) continue;

    if (filters.feeDone === true && !m.feeDone) continue;
    if (filters.feeDone === false && m.feeDone) continue;

    /**
     * Owes something — a closing, a joining fee, or either.
     *
     * `hasDue` has always meant closings only. A member whose only debt is
     * half a joining fee is invisible to it, which is exactly the member the
     * bulk-collection screen is looking for, so "owes anything" needs a
     * question of its own rather than a redefinition of the old one.
     */
    if (filters.hasFeeDue === true && !(feeDueOf(m) > 0)) continue;
    if (filters.hasFeeDue === false && feeDueOf(m) > 0) continue;

    if (filters.owesAnything === true
      && !((m.dueC ?? 0) > 0 || feeDueOf(m) > 0)) continue;

    if (minDue != null && !((m.due ?? 0) >= minDue)) continue;

    const score = scoreMember(m, q);
    if (score === 0) continue;

    out.push(q ? { ...m, _score: score } : m);
  }

  return out;
}

function toSet(v) {
  if (unset(v)) return null;
  const list = (Array.isArray(v) ? v : String(v).split(','))
    .map((x) => String(x).trim())
    .filter(Boolean);
  return list.length ? new Set(list.map((x) => (x === '_none' ? '' : x))) : null;
}

function numOrNull(v) {
  if (unset(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ── sorting ─────────────────────────────────────────────────────────────── */

const SORT_KEYS = {
  registrationNumber: (m) => numeric(m.reg),
  displayName: (m) => fold(m.name),
  fatherName: (m) => fold(m.father),
  village: (m) => fold(m.village),
  district: (m) => fold(m.dist),
  status: (m) => fold(m.status),
  age: (m) => Number(m.age ?? 0),
  joinDateMs: (m) => Number(m.joinMs ?? 0),
  dueAmount: (m) => Number(m.due ?? 0),
  dueCount: (m) => Number(m.dueC ?? 0),
  paidAmount: (m) => Number(m.paid ?? 0),
  lastPaymentAt: (m) => Number(m.lastPay ?? 0),
  agentName: (m) => fold(m.agent),
};

export const SORTABLE = Object.keys(SORT_KEYS);

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function sortMembers(items, sortBy = 'registrationNumber', sortDir = 'asc') {
  const key = SORT_KEYS[sortBy] ?? SORT_KEYS.registrationNumber;
  const dir = sortDir === 'desc' ? -1 : 1;

  // When a search is running, relevance wins — a user who typed a name is
  // asking "where is this person", not "sort my whole trust by name".
  const searching = items.some((m) => m._score != null);

  return [...items].sort((a, b) => {
    if (searching && a._score !== b._score) return b._score - a._score;

    const av = key(a);
    const bv = key(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return numeric(a.reg) - numeric(b.reg);
  });
}

/* ── facets ──────────────────────────────────────────────────────────────── */

/**
 * The distinct values the filter dropdowns offer, counted.
 *
 * Built from the same in-memory list, so the filter bar never costs a query of
 * its own and can never offer a village that no member lives in. Counts are
 * taken BEFORE filtering, so the options do not vanish as you narrow down —
 * a dropdown that empties itself as you use it is not a filter, it is a maze.
 */
export function facetsFor(items) {
  const villages = new Map();
  const districts = new Map();
  const bands = new Map();
  const agents = new Map();
  const programs = new Map();
  const genders = new Map();
  const statuses = new Map();

  for (const m of items) {
    bump(villages, m.village);
    bump(districts, m.dist);
    bump(bands, m.ageBand);
    bump(genders, fold(m.gen));
    bump(statuses, m.status);
    bump(agents, m.agentId ?? '', m.agent || 'सीधे जोड़ा गया');
    bump(programs, m.pid, m.prog);
  }

  return {
    villages: sortedFacet(villages),
    districts: sortedFacet(districts),
    ageBands: sortedFacet(bands),
    genders: sortedFacet(genders),
    statuses: sortedFacet(statuses),
    agents: sortedFacet(agents),
    programs: sortedFacet(programs),
  };
}

function bump(map, value, label) {
  if (value === undefined || value === null) return;
  const key = String(value);
  if (key === '' && label === undefined) return;
  const hit = map.get(key);
  if (hit) hit.count += 1;
  else map.set(key, { value: key === '' ? '_none' : key, label: label ?? key, count: 1 });
}

function sortedFacet(map) {
  return [...map.values()].sort(
    (a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)),
  );
}

/* ── totals ──────────────────────────────────────────────────────────────── */

/** Sums across the WHOLE filtered set, not just the page being shown. */
export function summarise(items) {
  let due = 0;
  let paid = 0;
  let withDue = 0;
  let feePending = 0;
  let feeDueAmount = 0;
  let feePaidAmount = 0;
  let feePartial = 0;

  for (const m of items) {
    due += m.due ?? 0;
    paid += m.paid ?? 0;
    if ((m.dueC ?? 0) > 0) withDue += 1;

    /**
     * The joining fee in money, not only in headcount.
     *
     * `feePending` counted members whose fee was not fully settled, which
     * cannot answer "how much joining-fee money is outstanding" — the question
     * anybody actually asks. A member owing ₹400 and one owing ₹11,000 both
     * counted as 1.
     */
    const feeLeft = feeDueOf(m);
    const feeIn = m.feePaid != null
      ? (Number(m.feePaid) || 0)
      : (m.feeDone ? (Number(m.fee) || 0) : 0);

    feeDueAmount += feeLeft;
    feePaidAmount += feeIn;
    if (feeLeft > 0) feePending += 1;
    if (feeLeft > 0 && feeIn > 0) feePartial += 1;
  }

  return {
    count: items.length,
    dueAmount: due,
    paidAmount: paid,
    withDue,
    /** Members with any part of their joining fee still outstanding. */
    feePending,
    /** Of those, the ones who have paid something towards it. */
    feePartial,
    feeDueAmount: Math.round(feeDueAmount * 100) / 100,
    feePaidAmount: Math.round(feePaidAmount * 100) / 100,
  };
}

/* ── paging ──────────────────────────────────────────────────────────────── */

export function paginate(items, { page = 1, limit = 50 } = {}) {
  const size = Math.max(1, Number(limit) || 50);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * size;

  return {
    rows: items.slice(start, start + size),
    page: current,
    pageSize: size,
    pages,
    total: items.length,
  };
}

/* ── grouped counts ──────────────────────────────────────────────────────── */

/** How each entry is bucketed, and what the bucket is called. */
/**
 * What is left of a member's joining fee.
 *
 * Index entries written before the amount was tracked carry only `feeDone`,
 * so that boolean stands in: paid means nothing left, unpaid means all of it.
 */
function feeDueOf(m) {
  if (m.feeDue != null) return Number(m.feeDue) || 0;
  return m.feeDone ? 0 : (Number(m.fee) || 0);
}

const GROUPERS = {
  status: (m) => [m.status, m.status],
  agent: (m) => [m.agentId ?? '_none', m.agent || 'सीधे जोड़ा गया'],
  program: (m) => [m.pid, m.prog],
  village: (m) => [m.village, m.village],
  district: (m) => [m.dist, m.dist],
  ageBand: (m) => [m.ageBand, m.ageBand],
  gender: (m) => [fold(m.gen), fold(m.gen)],
};

export const GROUPABLE = Object.keys(GROUPERS);

/**
 * Count and total members by one dimension.
 *
 * A plain count is rarely the question. "How many members does this agent
 * have" is nearly always followed by "and how much is outstanding on them",
 * so every bucket carries the money as well — and it costs nothing extra,
 * because the loop is already running.
 *
 * Statuses are broken out per bucket for the same reason: an agent with 300
 * members of whom 120 have left is a different agent from one with 300 active.
 */
export function groupMembers(items, by) {
  const key = GROUPERS[by];
  if (!key) return [];

  const map = new Map();

  for (const m of items) {
    const [value, label] = key(m);
    const id = String(value ?? '');
    if (id === '' && by !== 'agent') continue;

    let row = map.get(id);
    if (!row) {
      row = {
        value: id || '_none',
        label: label || '—',
        count: 0,
        active: 0,
        closed: 0,
        blocked: 0,
        left: 0,
        pending: 0,
        withDue: 0,
        dueAmount: 0,
        paidAmount: 0,
      };
      map.set(id, row);
    }

    row.count += 1;
    if (m.status === 'accepted') row.active += 1;
    else if (m.status === 'closed') row.closed += 1;
    else if (m.status === 'blocked') row.blocked += 1;
    else if (m.status === 'left') row.left += 1;
    else if (m.status === 'pending') row.pending += 1;

    if ((m.dueC ?? 0) > 0) row.withDue += 1;
    row.dueAmount += m.due ?? 0;
    row.paidAmount += m.paid ?? 0;
  }

  return [...map.values()].sort(
    (a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)),
  );
}

/**
 * The headline numbers, in the shape a dashboard wants.
 *
 * Every one of these is derived from the same in-memory list the member list
 * itself is served from, which is the point: a count on the dashboard and the
 * number of rows you get when you click through to it cannot disagree, because
 * they are the same computation over the same data.
 */
export function countsFor(items) {
  const byStatus = {
    total: items.length, accepted: 0, closed: 0, blocked: 0, left: 0, pending: 0,
  };

  let dueAmount = 0;
  let paidAmount = 0;
  let withDue = 0;
  let feePending = 0;

  for (const m of items) {
    if (byStatus[m.status] !== undefined) byStatus[m.status] += 1;
    dueAmount += m.due ?? 0;
    paidAmount += m.paid ?? 0;
    if ((m.dueC ?? 0) > 0) withDue += 1;
    if (!m.feeDone) feePending += 1;
  }

  return {
    members: byStatus,
    money: { dueAmount, paidAmount, withDue, feePending },
  };
}
