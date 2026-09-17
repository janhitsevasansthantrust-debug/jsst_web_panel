import { MEMBER_STATUS, LIMITS } from '../config/constants.js';

/**
 * Who owes a closing, and how much that comes to.
 *
 * ─── Why this replaced a number typed into a form ────────────────────────
 *
 * The closing form used to ask for "प्रति सदस्य राशि" and pre-fill it from the
 * rate of the member being closed. That number was wrong twice over. It was
 * the CLOSED member's rate, which has nothing to do with what anyone else
 * pays; and it implied one rate for everybody, when the whole point of the age
 * bands is that a 25-year-old and a 60-year-old contribute different amounts.
 *
 * What each member actually pays has always come from their own record —
 * `ledger.amountFor` puts `member.payAmount` ahead of anything on the closing
 * — so the typed figure never changed a single member's dues. It only changed
 * the REPORTED total, which is worse than useless: the screen said the closing
 * would raise ₹15,000 and the receipts added up to ₹17,300, and there was no
 * way to tell which was the lie.
 *
 * So the expected total is summed from the members themselves, band by band.
 * Pure, because it is a money figure people plan around, and it runs against
 * the shared member index — already in memory — so a 5,000-member trust costs
 * nothing to total.
 */

/**
 * @param items   the member search index (short-key entries)
 * @param opts.programId       only this योजना's members
 * @param opts.closingDateMs   the closing's date — eligibility is by date
 * @param opts.exceptMemberId  the member being closed never owes their own
 */
export function eligibleForClosing(
  items,
  { programId, closingDateMs, exceptMemberId, includeBlocked = true } = {},
) {
  const date = Number(closingDateMs);
  const bands = new Map();

  let count = 0;
  let amount = 0;

  for (const m of items ?? []) {
    if (programId && m.pid !== programId) continue;
    if (exceptMemberId && m.id === exceptMemberId) continue;

    /**
     * Only accepted members.
     *
     * A member already closed has left, and a pending one has not joined yet.
     * Blocked members are NOT excluded — a block is a warning, not an exit,
     * and their dues go on accruing. (That is the trust's own rule, confirmed
     * rather than assumed.)
     */
    if (m.status === MEMBER_STATUS.BLOCKED) {
      // The closing's own rule, so the snapshot bills exactly whom the ledger
      // will. Two different answers on one screen is worse than either.
      if (!includeBlocked) continue;
    } else if (m.status !== MEMBER_STATUS.ACCEPTED) {
      continue;
    }

    const joined = Number(m.joinMs);
    if (!Number.isFinite(joined)) continue;
    // Joined ON the day: owes. Joined after: does not. The same boundary the
    // ledger uses, written here too rather than imported, because a snapshot
    // that disagreed with the ledger would be worse than no snapshot.
    if (Number.isFinite(date) && joined > date) continue;

    const rate = Number(m.pay) > 0 ? Number(m.pay) : LIMITS.DEFAULT_PAY_AMOUNT;

    count += 1;
    amount += rate;

    const band = m.ageBand || '—';
    const row = bands.get(band) ?? { band, count: 0, amount: 0, rate };
    row.count += 1;
    row.amount += rate;
    bands.set(band, row);
  }

  return {
    count,
    amount,
    /**
     * A single representative rate, for the fallback and for display.
     *
     * The average, not "the" rate — there isn't one. It is stored on the
     * closing ONLY so that a member with no rate of their own has something
     * sane to fall back to; it can never override a member who has one.
     */
    typicalAmount: count ? Math.round(amount / count) : LIMITS.DEFAULT_PAY_AMOUNT,
    byBand: [...bands.values()].sort(byLeadingNumber),
  };
}

/** "17-22" before "23-45" before "46-60" — sorted by the age, not the string. */
function byLeadingNumber(a, b) {
  const n = (s) => Number(String(s.band).match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return n(a) - n(b) || String(a.band).localeCompare(String(b.band));
}
