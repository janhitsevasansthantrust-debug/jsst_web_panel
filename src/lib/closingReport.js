import { CLOSING_STATUS } from '../config/constants.js';

/**
 * The क्लोजिंग सूची — filtering and totalling, without a database.
 *
 * Pure, and in `lib/` for the usual reason: these are the numbers a committee
 * reads off a printed page, and a wrong total there is argued about for a
 * month. They deserve tests, and tests deserve not to need Firestore.
 */

/**
 * Closings whose date falls inside the range, newest first.
 *
 * Both ends are INCLUSIVE, and the caller is expected to have widened `toMs`
 * to the end of its day — a range typed as "1st to 30th" that silently
 * excluded everything after midnight on the 30th would drop a whole day's
 * closings and look merely short, not wrong.
 */
export function filterClosingsByDate(index, { fromMs, toMs } = {}) {
  const from = Number.isFinite(Number(fromMs)) ? Number(fromMs) : null;
  const to = Number.isFinite(Number(toMs)) ? Number(toMs) : null;

  return (index ?? [])
    .filter((c) => {
      const d = Number(c.dateMs);
      if (!Number.isFinite(d)) return false;
      if (from != null && d < from) return false;
      if (to != null && d > to) return false;
      return true;
    })
    .slice()
    .sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0) || (b.seq ?? 0) - (a.seq ?? 0));
}

/**
 * What the period came to.
 *
 * Reverted closings are counted separately and contribute NOTHING to the
 * money: they are not owed, so including their expected amount would inflate
 * the trust's outstanding figure by exactly the amount it decided not to
 * collect. They are still counted as rows, because "we took three back this
 * month" is the sort of thing a committee asks about.
 *
 * `pending` is derived as expected − collected rather than summed from the
 * members, because that is the figure the closing itself can vouch for. A
 * member's own dues are computed from dates at the moment they are asked for,
 * and mixing the two on one page produces two numbers that disagree by a
 * rounding of somebody's part payment.
 */
export function summariseClosings(rows) {
  let active = 0;
  let reverted = 0;
  let expected = 0;
  let collected = 0;

  for (const c of rows) {
    if (c.status === CLOSING_STATUS.REVERTED) {
      reverted += 1;
      continue;
    }
    active += 1;
    expected += Number(c.eligibleAmount) || 0;
    collected += Number(c.paidAmount) || 0;
  }

  return {
    count: rows.length,
    active,
    reverted,
    expected,
    collected,
    pending: Math.max(0, expected - collected),
  };
}

/** Each row with the one figure the index does not store: what is still out. */
export function withPending(rows) {
  return rows.map((c) => {
    if (c.status === CLOSING_STATUS.REVERTED) return { ...c, pendingAmount: null };

    const expected = Number(c.eligibleAmount) || 0;
    const paid = Number(c.paidAmount) || 0;
    return { ...c, pendingAmount: Math.max(0, expected - paid) };
  });
}
