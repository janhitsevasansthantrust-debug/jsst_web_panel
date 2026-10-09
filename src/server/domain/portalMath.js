/**
 * portalMath.js — the numbers the agent and member apps show.
 *
 * PURE, like ledger.js: no Firestore, no `Date.now()`, no I/O. Everything here
 * is built on `ledger.isEligible` / `amountFor` / `readLedger`, so the member
 * app and the counter can never disagree about who owes what. These functions
 * only ARRANGE that answer per closing and per payment; they never decide it.
 */

import { isEligible, amountFor, readLedger } from './ledger.js';
import { LIMITS } from '../../config/constants.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Where each paid seq was paid: the earliest live receipt line for it.
 *
 * Cancelled receipts and lines reversed by a closing revert are skipped — a
 * line that went back is not a payment, and showing its date as "paid on"
 * would contradict the due list right beside it.
 */
export function paymentsBySeq(receipts = []) {
  const map = new Map();
  for (const r of receipts) {
    if (!r || r.status === 'cancelled' || r.delete_flag) continue;
    const reversed = new Set((r.reversedSeqs ?? []).map(Number));
    for (const item of r.items ?? []) {
      const seq = Number(item.seq);
      if (!Number.isFinite(seq) || reversed.has(seq)) continue;
      const prev = map.get(seq);
      const line = {
        receiptId: r.id ?? null,
        receiptNo: r.receiptNo ?? '',
        paidAtMs: num(r.paidAtMs) || null,
        amount: num(item.amount),
        method: r.method ?? '',
      };
      if (!prev) {
        map.set(seq, { ...line, lines: 1 });
      } else {
        // A part payment completed later: the instalment is settled on the
        // date of its LAST piece, and the amounts add up.
        map.set(seq, {
          ...prev,
          amount: prev.amount + line.amount,
          lines: prev.lines + 1,
          paidAtMs: Math.max(prev.paidAtMs ?? 0, line.paidAtMs ?? 0) || prev.paidAtMs,
          receiptNo: line.paidAtMs >= (prev.paidAtMs ?? 0) ? line.receiptNo : prev.receiptNo,
          receiptId: line.paidAtMs >= (prev.paidAtMs ?? 0) ? line.receiptId : prev.receiptId,
        });
      }
    }
  }
  return map;
}

/**
 * The last day an instalment counts as on time.
 *
 * The closing's notice date when it was billed on one (that is the date the
 * family was actually told), otherwise the closing date plus the grace window.
 */
export function dueByFor(closing, { batchDueMs = {}, graceDays = LIMITS.PAYMENT_GRACE_DAYS } = {}) {
  const fromBatch = closing.batchId ? num(batchDueMs[closing.batchId]) : 0;
  if (fromBatch > 0) return endOfDay(fromBatch);
  if (!Number.isFinite(Number(closing.dateMs))) return null;
  return endOfDay(Number(closing.dateMs) + Math.max(0, num(graceDays)) * DAY_MS);
}

/**
 * 23:59:59.999 India time on the day `ms` falls on.
 *
 * Dates here are entered in India and stored as local midnight, which is
 * 18:30 UTC the day before. Rounding in UTC would put a payment made at 10am
 * on the last day on the wrong side of midnight.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function endOfDay(ms) {
  const istDayStart = Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return istDayStart + DAY_MS - 1;
}

/**
 * One member's whole history, closing by closing.
 *
 * Every closing this member was ever liable for, oldest first, each with:
 *   status   'paid' | 'partial' | 'pending' | 'exempt'
 *   amount   what this member owes for it (their own rate)
 *   paid     what has been received against it
 *   remaining
 *   paidAtMs / receiptNo     when and on which रसीद it was settled
 *   timing   'onTime' | 'late' | 'unknown' (paid before receipts existed)
 *   daysTaken  days from the closing date to the payment
 *   overdue  for a pending one: is it already past its last date?
 *
 * @param {object} member     the member document (with id)
 * @param {Array}  closings   the closings index for the member's योजना
 * @param {Array}  receipts   that member's receipts
 * @param {{nowMs:number, batchDueMs?:object, graceDays?:number}} opts
 */
export function memberTimeline(member, closings = [], receipts = [], opts = {}) {
  const { nowMs = 0 } = opts;
  const { paidUpTo, paidSeqs, exemptSeqs, partialPaid } = readLedger(member);
  const paidSet = new Set(paidSeqs);
  const exemptSet = new Set(exemptSeqs);
  const bySeq = paymentsBySeq(receipts);

  const rows = [];
  const sorted = [...closings].sort((a, b) => num(a.dateMs) - num(b.dateMs) || num(a.seq) - num(b.seq));

  for (const c of sorted) {
    if (!isEligible(member, c)) continue;

    const amount = amountFor(member, c);
    const dueBy = dueByFor(c, opts);
    const pay = bySeq.get(c.seq) ?? null;

    let status;
    let paid;
    if (exemptSet.has(c.seq) && c.seq > paidUpTo) {
      status = 'exempt';
      paid = 0;
    } else if (c.seq <= paidUpTo || paidSet.has(c.seq)) {
      status = 'paid';
      paid = amount;
    } else {
      const part = num(partialPaid[c.seq]);
      if (part >= amount) {
        status = 'paid';
        paid = amount;
      } else {
        status = part > 0 ? 'partial' : 'pending';
        paid = part;
      }
    }

    const remaining = status === 'exempt' ? 0 : Math.max(0, amount - paid);

    let timing = null;
    let daysTaken = null;
    let lateByDays = null;
    if (status === 'paid') {
      if (pay?.paidAtMs) {
        daysTaken = Math.max(0, Math.round((pay.paidAtMs - num(c.dateMs)) / DAY_MS));
        timing = dueBy != null && pay.paidAtMs > dueBy ? 'late' : 'onTime';
        if (timing === 'late') lateByDays = Math.ceil((pay.paidAtMs - dueBy) / DAY_MS);
      } else {
        // Settled by the watermark with no receipt line here — migrated from
        // the old system, or paid on a receipt older than the ones loaded.
        timing = 'unknown';
      }
    }

    const overdue = remaining > 0 && dueBy != null && nowMs > dueBy;

    rows.push({
      seq: c.seq,
      closingId: c.id,
      name: c.name ?? '',
      regNo: c.regNo ?? '',
      fatherName: c.fatherName ?? '',
      village: c.village ?? '',
      dateMs: c.dateMs ?? null,
      batchId: c.batchId ?? null,
      dueByMs: dueBy,
      amount,
      paid,
      remaining,
      status,
      paidAtMs: status === 'paid' || status === 'partial' ? (pay?.paidAtMs ?? null) : null,
      receiptNo: pay?.receiptNo ?? '',
      receiptId: pay?.receiptId ?? null,
      timing,
      daysTaken,
      lateByDays,
      overdue,
      overdueDays: overdue ? Math.ceil((nowMs - dueBy) / DAY_MS) : 0,
    });
  }

  return rows;
}

/** Headline figures over a timeline — the cards at the top of the member page. */
export function summariseTimeline(rows = []) {
  const s = {
    eligibleCount: 0, eligibleAmount: 0,
    paidCount: 0, paidAmount: 0,
    pendingCount: 0, pendingAmount: 0,
    partialCount: 0,
    exemptCount: 0,
    onTimeCount: 0, onTimeAmount: 0,
    lateCount: 0, lateAmount: 0,
    unknownCount: 0, unknownAmount: 0,
    overdueCount: 0, overdueAmount: 0,
  };
  for (const r of rows) {
    if (r.status === 'exempt') { s.exemptCount += 1; continue; }
    s.eligibleCount += 1;
    s.eligibleAmount += r.amount;
    if (r.status === 'paid') {
      s.paidCount += 1;
      s.paidAmount += r.paid;
      if (r.timing === 'late') { s.lateCount += 1; s.lateAmount += r.paid; }
      else if (r.timing === 'onTime') { s.onTimeCount += 1; s.onTimeAmount += r.paid; }
      else { s.unknownCount += 1; s.unknownAmount += r.paid; }
    } else {
      s.paidAmount += r.paid;
      s.pendingCount += 1;
      s.pendingAmount += r.remaining;
      if (r.status === 'partial') s.partialCount += 1;
      if (r.overdue) { s.overdueCount += 1; s.overdueAmount += r.remaining; }
    }
  }
  return s;
}

/**
 * Per closing, what one agent's members owe and have paid.
 *
 * `members` are full ledger-bearing records (the member index carries the
 * ledger, so these cost no reads). Reverted closings are skipped — they are
 * not owed by anybody.
 */
export function closingsForMembers(members = [], closings = []) {
  const active = closings.filter((c) => !c.status || c.status === 'active');
  const out = new Map(active.map((c) => [c.seq, {
    seq: c.seq,
    closingId: c.id,
    name: c.name ?? '',
    regNo: c.regNo ?? '',
    fatherName: c.fatherName ?? '',
    village: c.village ?? '',
    dateMs: c.dateMs ?? null,
    batchId: c.batchId ?? null,
    eligibleCount: 0, eligibleAmount: 0,
    paidCount: 0, paidAmount: 0,
    pendingCount: 0, pendingAmount: 0,
  }]));

  for (const m of members) {
    for (const row of memberTimeline(m, active, [], {})) {
      const agg = out.get(row.seq);
      if (!agg || row.status === 'exempt') continue;
      agg.eligibleCount += 1;
      agg.eligibleAmount += row.amount;
      agg.paidAmount += row.paid;
      if (row.status === 'paid') agg.paidCount += 1;
      else { agg.pendingCount += 1; agg.pendingAmount += row.remaining; }
    }
  }

  return [...out.values()]
    .filter((c) => c.eligibleCount > 0)
    .sort((a, b) => num(b.dateMs) - num(a.dateMs) || b.seq - a.seq);
}

/** Totals over `closingsForMembers` rows. */
export function totalClosings(rows = []) {
  return rows.reduce((t, r) => ({
    closings: t.closings + 1,
    eligibleAmount: t.eligibleAmount + r.eligibleAmount,
    paidAmount: t.paidAmount + r.paidAmount,
    pendingAmount: t.pendingAmount + r.pendingAmount,
    pendingCount: t.pendingCount + r.pendingCount,
    paidCount: t.paidCount + r.paidCount,
  }), { closings: 0, eligibleAmount: 0, paidAmount: 0, pendingAmount: 0, pendingCount: 0, paidCount: 0 });
}

/** Digits only, last ten — how two phone numbers are compared. */
export function phoneKey(v) {
  const d = String(v ?? '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * Members linked to `self` by mobile number, across every योजना.
 *
 * `entries` are member-index entries (short keys). A number shorter than six
 * digits links nobody — that is a typo, not a family.
 */
export function linkedEntries(self, entries = []) {
  const phones = new Set(
    [self?.phone, self?.phoneAlt].map(phoneKey).filter((p) => p.length >= 6),
  );
  return entries.filter((e) => {
    if (e.id === self?.id) return true;
    if (!phones.size) return false;
    return phones.has(phoneKey(e.phone)) || phones.has(phoneKey(e.ph2));
  });
}

/** `XXXX XXXX 1234` — a member's own app never needs the whole आधार. */
export function maskAadhaar(v) {
  const d = String(v ?? '').replace(/\D+/g, '');
  if (d.length < 4) return '';
  return `XXXX XXXX ${d.slice(-4)}`;
}
