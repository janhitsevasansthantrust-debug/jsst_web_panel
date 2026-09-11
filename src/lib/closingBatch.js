/**
 * क्लोजिंग समूह — the pure parts.
 *
 * In `lib/` rather than beside the Firestore code for the usual reason: these
 * three functions decide what goes on a printed bill and what it adds up to,
 * which is exactly the sort of thing that must be testable without a database.
 * `server/domain/closingBatches.js` re-exports them, so callers need not know.
 */

import { CLOSING_STATUS } from '../config/constants.js';

/** A short code for receipt numbers — `SEP26-2026-000123`. */
export function batchCode(name) {
  const latin = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6);

  if (latin.length >= 2) return latin;

  // A Devanagari name has no Latin letters to take. Digits in the name are the
  // next best thing — "सितंबर 2026" becomes "2026" — because a receipt number
  // gets read out over a telephone, and Devanagari in the middle of one does
  // not survive that.
  const digits = String(name ?? '').replace(/\D+/g, '').slice(0, 6);
  return digits.length >= 2 ? digits : 'GRP';
}

/**
 * The closings in a batch, oldest first.
 *
 * Pure, and separated from the read for that reason — the ordering and the
 * totals are the part worth testing, and they need no database to test.
 *
 * Reverted closings are dropped rather than shown struck through: a notice is
 * a bill, and a bill that lists something nobody owes gets paid by somebody.
 */
export function selectBatchRows(index, batchId) {
  /**
   * No batch means no sheet — NOT "every closing that has no batch".
   *
   * Without this guard, `batchId === null` matches every unbatched closing
   * (they store `batchId: null` too), so a missing id would print a notice
   * billing members for a pile of closings nobody had grouped.
   */
  if (!batchId) return [];

  return (index ?? [])
    .filter((c) => c.batchId === batchId && c.status !== CLOSING_STATUS.REVERTED)
    .slice()
    .sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0) || (a.seq ?? 0) - (b.seq ?? 0));
}

/**
 * What one member is being asked for.
 *
 * The per-closing amounts are summed rather than multiplied by a single rate,
 * because closings in the same batch can carry different rates — an override
 * on one of them, or a trust that changed its rate mid-month. Multiplying by
 * "the" rate would be right almost always, and quietly wrong exactly when
 * somebody had already been told a different number.
 *
 * It is still an INDICATIVE total: a member's own rate comes from their age
 * band, so the notice prints the standard per-closing amount and each member's
 * actual dues remain whatever `ledger.computeDue` says.
 */
export function summariseBatch(rows) {
  const perMemberAmount = rows.reduce(
    (sum, c) => sum + (Number(c.amount ?? c.amountPerMember) || 0),
    0,
  );

  return {
    rows,
    count: rows.length,
    perMemberAmount,
    firstDateMs: rows.length ? rows[0].dateMs : null,
    lastDateMs: rows.length ? rows[rows.length - 1].dateMs : null,
  };
}
