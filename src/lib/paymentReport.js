import { PAYMENT_STATUS } from '../config/constants.js';
import { paymentMethodLabel, paymentStatusLabel } from '../config/labels.js';

/**
 * The receipt register (लेन-देन) — one predicate, one set of totals.
 *
 * Pure, and in `lib/` beside `closingReport.js` for the usual reason: these
 * are the figures a committee reads off a printed page, and a wrong total
 * there is argued about for a month. They deserve tests, and tests deserve not
 * to need Firestore.
 *
 * The predicate is shared deliberately. The paginated list on screen and the
 * file that gets downloaded are two views of the same question, and a filter
 * written twice is a filter that drifts — an export that quietly disagrees
 * with the rows somebody already checked is worse than no export at all,
 * because it looks like a reconciliation.
 */

/**
 * Does this receipt belong in the result?
 *
 * `seqs` is the set of closing seqs the caller picked out of the closings
 * index — `null` when no closing filter is on. The date window here is the
 * INSTALMENT date (`item.closingDateMs`), not the day the money was taken;
 * the payment day is `paidFromMs`/`paidToMs` and is deliberately a separate
 * thing. Confusing the two produces a register that is wrong by a month and
 * reads as merely odd.
 */
export function matchesPayment(receipt, f = {}, seqs = null) {
  const paid = Number(receipt.paidAtMs) || 0;
  if (f.paidFromMs && paid < Number(f.paidFromMs)) return false;
  if (f.paidToMs && paid > Number(f.paidToMs)) return false;

  if (f.method && receipt.method !== f.method) return false;
  if (f.status && receipt.status !== f.status) return false;

  if (f.q && !searchable(receipt).includes(String(f.q).trim().toLowerCase())) {
    return false;
  }

  const filterClosing = Boolean(f.closingId || f.batchId || f.fromMs || f.toMs);
  if (!filterClosing) return true;

  return (receipt.items ?? []).some((item) => {
    if (f.closingId && !(seqs ?? new Set()).has(item.seq)) return false;
    if (
      f.batchId &&
      (item.batchId != null ? item.batchId !== f.batchId : !(seqs ?? new Set()).has(item.seq))
    ) {
      return false;
    }
    const date = Number(item.closingDateMs ?? item.dateMs) || 0;
    if (f.fromMs && date < Number(f.fromMs)) return false;
    if (f.toMs && date > Number(f.toMs)) return false;
    return true;
  });
}

/** Everything on a receipt a clerk might type, lowercased once. */
function searchable(receipt) {
  const m = receipt.memberSnapshot ?? {};
  return [
    receipt.receiptNo,
    receipt.groupCode,
    receipt.reference,
    receipt.note,
    receipt.collectedByAgentName,
    m.name,
    m.regNo,
    m.fatherName,
    m.village,
    m.phone,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * What the filter came to.
 *
 * `collected` counts only receipts that still stand. A cancelled receipt did
 * move money and then gave it back, so including it would inflate the trust's
 * collection by exactly the amount it no longer has — the same reasoning
 * `summariseClosings` applies to a reverted closing. It is still counted as a
 * row and its amount is reported separately, because "we took four back this
 * month" is a thing a committee asks about.
 *
 * The split is exact rather than approximate: `postOneReceipt` writes
 * `totalAmount = closingAmount + joinFeeAmount`, so `closingAmount +
 * joinFeeAmount === collected` for every receipt this system has written.
 */
export function summarisePayments(rows) {
  const members = new Set();

  let count = 0;
  let cancelled = 0;
  let collected = 0;
  let cancelledAmount = 0;
  let closingAmount = 0;
  let joinFeeAmount = 0;

  for (const r of rows) {
    count += 1;
    const total = Number(r.totalAmount) || 0;

    if (r.status === PAYMENT_STATUS.CANCELLED) {
      cancelled += 1;
      cancelledAmount += total;
      continue;
    }

    collected += total;
    closingAmount += Number(r.closingAmount) || 0;
    joinFeeAmount += Number(r.joinFeeAmount) || 0;
    if (r.memberId) members.add(r.memberId);
  }

  return {
    count,
    completed: count - cancelled,
    cancelled,
    collected,
    cancelledAmount,
    closingAmount,
    joinFeeAmount,
    members: members.size,
  };
}

/**
 * Say on the document which filters produced it.
 *
 * A printed register that does not state what it was filtered by is a document
 * nobody can check three months later — and someone always tries.
 */
export function describePaymentFilters(f = {}) {
  const out = [];

  if (f.paidFromMs || f.paidToMs) {
    out.push(`रसीद तिथि ${d(f.paidFromMs)} – ${d(f.paidToMs)}`);
  }
  if (f.method) out.push(`तरीका: ${paymentMethodLabel(f.method)}`);
  if (f.status) out.push(`स्थिति: ${paymentStatusLabel(f.status)}`);
  if (f.agentName || f.agentId) out.push(`एजेंट: ${f.agentName || f.agentId}`);
  if (f.q) out.push(`खोज "${f.q}"`);
  if (f.batchId) out.push('एक समूह की रसीदें');
  if (f.closingId) out.push('एक क्लोजिंग की रसीदें');
  if (f.fromMs || f.toMs) out.push(`क्लोजिंग तिथि ${d(f.fromMs)} – ${d(f.toMs)}`);

  return out;
}

function d(ms) {
  return ms ? new Date(Number(ms)).toLocaleDateString('hi-IN') : '…';
}
