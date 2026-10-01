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
