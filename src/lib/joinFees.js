/**
 * The joining fee, which is not always paid in one go.
 *
 * `joinFees` is what the member owes to enrol — ₹11,000, say, set by their age
 * band. For years the system recorded only whether that had been paid:
 * `joinFeesDone`, a boolean. So a member who put down ₹2,100 at the counter was
 * either marked fully paid (and the trust lost ₹8,900 from its books) or marked
 * unpaid (and the ₹2,100 they had handed over appeared nowhere). Neither is a
 * record of what happened.
 *
 * What is stored now is the AMOUNT paid, `joinFeesPaid`, incremented by each
 * receipt that carries a joining fee. Everything else — what is left, whether
 * it is settled, whether it is part-paid — is read off that, here, in one
 * place, so no screen can disagree with another about it.
 *
 * `joinFeesDone` and `joinFeesDue` are still written to the member document,
 * because filters and the search index need a plain field to match on. They are
 * mirrors of this calculation, never the source of it.
 */

/** Paise matter here — a fee can be settled in odd instalments. */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Within a paisa is paid up. Floating-point addition of 2100 + 8900 does not
 * always land exactly on 11000, and a member must not be left owing ₹0.001.
 */
const EPSILON = 0.009;

/**
 * What this member still owes on their joining fee.
 *
 * @param {object} member
 * @returns {{total:number, paid:number, due:number, done:boolean,
 *            partial:boolean, over:number}}
 */
export function joinFeesState(member) {
  const total = round2(member?.joinFees);

  /**
   * Members enrolled before the amount was tracked have no `joinFeesPaid` at
   * all — only the old boolean. Reading those as "₹0 paid" would resurrect a
   * fee every one of them had already settled, and put it on the counter
   * screen as money to collect. So the boolean is honoured as "all of it", and
   * the number takes over from the first payment onwards.
   */
  const paid =
    member?.joinFeesPaid === undefined || member?.joinFeesPaid === null
      ? (member?.joinFeesDone ? total : 0)
      : round2(member.joinFeesPaid);

  const due = round2(Math.max(0, total - paid));

  return {
    total,
    paid,
    due,
    done: due <= EPSILON,
    partial: paid > EPSILON && due > EPSILON,
    /** Paid more than the fee — should not happen, but is worth surfacing. */
    over: round2(Math.max(0, paid - total)),
  };
}

/**
 * The member fields to write after a joining-fee payment of `amount`.
 *
 * Returns absolute values rather than increments, and that is deliberate: the
 * caller reads the member inside the same transaction, so the arithmetic is
 * already safe, and `joinFeesDone` cannot be derived from an increment —
 * "is it settled now" needs the resulting total, not the delta.
 *
 * Pass a negative `amount` to reverse a cancelled receipt.
 */
export function applyJoinFeePayment(member, amount) {
  const { total, paid } = joinFeesState(member);
  const next = round2(Math.max(0, paid + round2(amount)));
  const due = round2(Math.max(0, total - next));

  return {
    joinFeesPaid: next,
    joinFeesDue: due,
    joinFeesDone: due <= EPSILON,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   किश्त में नामांकन शुल्क — part now, the rest when the member is closed
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What happens to the unpaid part of a joining fee when the member is closed.
 *
 *   deduct  — taken out of the सहयोग राशि the family is handed (default)
 *   collect — the family pays it in at the counter, like any other receipt
 *
 * Either way it is recorded as a real joining-fee receipt, so the member's
 * `joinFeesPaid`, the day's collection and the agent's commission all move
 * together. A deduction typed only onto the समापन पत्र would leave the fee
 * "due" on the member for ever.
 */
export const JOIN_FEE_BALANCE = {
  DEDUCT: 'deduct',
  COLLECT: 'collect',
};

/**
 * How an age band splits its joining fee.
 *
 * A band with `joinFeeAtJoin` set — ₹2,100 against a ₹11,000 fee, say — takes
 * that much when the member enrols and leaves the rest outstanding until their
 * closing. A band without it (or with a figure that is not actually less than
 * the fee) takes the whole fee up front, exactly as before.
 *
 * @param {{joinFee?:number, joinFeeAtJoin?:number}} band
 * @returns {{total:number, atJoin:number, later:number, instalment:boolean}}
 */
export function joinFeeSplit(band) {
  const total = round2(band?.joinFee ?? band?.joinFees);
  const wanted = round2(band?.joinFeeAtJoin);
  const instalment = wanted > EPSILON && wanted < total - EPSILON;
  const atJoin = instalment ? wanted : total;
  return {
    total,
    atJoin,
    later: round2(total - atJoin),
    instalment,
  };
}

/**
 * The joining fee to take out of a closing payout, before anybody edits it.
 *
 * Only a suggestion for the form — the operator decides, and the server
 * re-checks the figure against what is really outstanding inside the
 * transaction that writes the receipt.
 *
 * @param {object} member
 * @param {string} [mode] JOIN_FEE_BALANCE value of the योजना
 * @param {number} [payable] what the family is being handed; a deduction can
 *        never exceed it
 */
export function suggestedClosingDeduction(member, mode = JOIN_FEE_BALANCE.DEDUCT, payable) {
  if (mode !== JOIN_FEE_BALANCE.DEDUCT) return 0;
  const { due } = joinFeesState(member);
  if (payable === undefined || payable === null) return due;
  return round2(Math.max(0, Math.min(due, Number(payable) || 0)));
}

/**
 * The net figure on the समापन पत्र: what is handed over, less the member's
 * own arrears and whatever joining fee is being taken out of it.
 */
export function closingNetAmount({ amountGiven, oldPending, joinFeeDeducted } = {}) {
  return round2(Math.max(0,
    round2(amountGiven) - round2(oldPending) - round2(joinFeeDeducted)));
}

/**
 * How much of a joining-fee payment earns the agent commission.
 *
 * Only the part taken at enrolment does — the ₹2,100 of an ₹11,000 fee split
 * as "जुड़ते समय लें". The ₹8,900 settled later (at the counter or out of the
 * closing payout) is the trust recovering what the member owed, not the agent
 * enrolling anybody, so it earns nothing.
 *
 * Counted against what the member had ALREADY paid, so it works however the
 * money arrives: ₹2,100 in one go earns on ₹2,100; ₹1,000 + ₹1,500 earns on
 * ₹1,000 and then ₹1,100; anything after ₹2,100 earns on ₹0. A cancelled
 * receipt lowers `joinFeesPaid` again, so the replacement earns as it should.
 *
 * A fee that is not split (and every member enrolled before splitting existed,
 * who has no `joinFeeAtJoin`) earns on the whole fee, exactly as before.
 *
 * @param {object} member  as read BEFORE this payment is applied
 * @param {number} amount  the joining fee on this receipt
 */
export function commissionableJoinFee(member, amount) {
  const { total, paid } = joinFeesState(member);
  const atJoin = member?.joinFeeAtJoin === undefined || member?.joinFeeAtJoin === null
    ? total
    : joinFeeSplit({ joinFee: total, joinFeeAtJoin: member.joinFeeAtJoin }).atJoin;
  const room = round2(Math.max(0, atJoin - paid));
  return round2(Math.max(0, Math.min(round2(amount), room)));
}

/**
 * The `joinFeeAtJoin` an EXISTING member should get when a योजना's split is
 * applied to members who joined before it existed.
 *
 * Their band is found by the id stored on the member (`ageGroup`), falling back
 * to the range text for members whose band ids were regenerated. The member's
 * own `joinFees` is kept as the total — it is what they were enrolled on, and a
 * band whose fee was raised later must not raise it for them. Only the split
 * moves: at-join is the band's figure, capped at that total.
 *
 * Returns null when there is nothing to do (no band found, or the band takes
 * the whole fee up front and the member already says so).
 *
 * @param {object} member
 * @param {object[]} ageGroups the योजना's bands
 * @returns {number|null}
 */
export function joinFeeAtJoinForExisting(member, ageGroups) {
  const bands = Array.isArray(ageGroups) ? ageGroups : [];
  const band =
    bands.find((g) => g.id && g.id === member?.ageGroup) ??
    bands.find((g) => `${g.startAge}-${g.endAge}` === member?.ageGroupRange) ??
    null;
  if (!band) return null;

  const total = round2(member?.joinFees);
  const split = joinFeeSplit({ joinFee: total, joinFeeAtJoin: band.joinFeeAtJoin });
  const current = member?.joinFeeAtJoin === undefined || member?.joinFeeAtJoin === null
    ? total
    : round2(member.joinFeeAtJoin);

  return split.atJoin === current ? null : split.atJoin;
}
