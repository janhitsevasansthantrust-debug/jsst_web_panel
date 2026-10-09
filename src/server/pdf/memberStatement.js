import 'server-only';

import { tablePdfResponse, rupees, dmy } from './respond.js';

const STATUS = { paid: 'जमा', partial: 'आंशिक', pending: 'बकाया', exempt: 'छूट' };
const TIMING = { onTime: 'समय पर', late: 'देर से', unknown: '—' };

/**
 * A member's account statement, closing by closing — what the member and agent
 * apps show, printed. `detail` is `buildMemberDetail`'s result, so the paper
 * and the screen are the same computation.
 *
 * mode: all | pending | paid | late
 */
export function memberStatementPdf({ trust, detail, mode }) {
  const m = detail.member;
  const pick = ['pending', 'paid', 'late'].includes(mode) ? mode : 'all';
  const rows = detail.timeline.filter((r) => {
    if (pick === 'pending') return r.remaining > 0;
    if (pick === 'paid') return r.status === 'paid';
    if (pick === 'late') return r.timing === 'late';
    return true;
  });
  const s = detail.summary;
  const title = {
    all: 'सदस्य खाता विवरण', pending: 'बकाया विवरण', paid: 'जमा विवरण', late: 'देर से जमा विवरण',
  }[pick];

  return tablePdfResponse({
    trust,
    title,
    lines: [
      `${m.displayName}  ·  रजि. ${m.registrationNumber}  ·  पिता/पति: ${m.fatherName || '—'}  ·  ${m.village || ''}`,
      `योजना: ${m.programName || '—'}  ·  मोबाइल: ${m.phone || '—'}  ·  जुड़ने की तिथि: ${dmy(m.joinDateMs)}  ·  प्रति क्लोजिंग ₹${rupees(m.payAmount)}`,
      `नामांकन शुल्क: ₹${rupees(detail.joinFee.total)} — जमा ₹${rupees(detail.joinFee.paid)}, बाकी ₹${rupees(detail.joinFee.due)}`,
    ],
    columns: [
      { key: 'seq', header: 'क्र.', width: 4, align: 'center' },
      { key: 'name', header: 'क्लोजिंग (सदस्य)', width: 20 },
      { key: 'date', header: 'क्लोजिंग तिथि', width: 10 },
      { key: 'amount', header: 'राशि', width: 7, align: 'right' },
      { key: 'paid', header: 'जमा', width: 7, align: 'right' },
      { key: 'left', header: 'बाकी', width: 7, align: 'right' },
      { key: 'status', header: 'स्थिति', width: 7, align: 'center' },
      { key: 'paidOn', header: 'जमा तिथि', width: 10 },
      { key: 'receipt', header: 'रसीद', width: 14 },
      { key: 'timing', header: 'समय', width: 8 },
    ],
    rows: rows.map((r) => ({
      seq: r.seq,
      name: `${r.name}${r.regNo ? ` (${r.regNo})` : ''}`,
      date: dmy(r.dateMs),
      amount: rupees(r.amount),
      paid: rupees(r.paid),
      left: rupees(r.remaining),
      status: STATUS[r.status] ?? r.status,
      paidOn: dmy(r.paidAtMs),
      receipt: r.receiptNo,
      timing: r.status === 'paid'
        ? (r.timing === 'late' ? `देर (${r.lateByDays} दिन)` : TIMING[r.timing] ?? '')
        : (r.overdue ? `समय निकला` : ''),
    })),
    totals: [
      `कुल पात्र: ${s.eligibleCount} क्लोजिंग, ₹${rupees(s.eligibleAmount)}  ·  जमा: ${s.paidCount}, ₹${rupees(s.paidAmount)}  ·  बकाया: ${s.pendingCount}, ₹${rupees(s.pendingAmount)}`,
      `समय पर जमा: ${s.onTimeCount} (₹${rupees(s.onTimeAmount)})  ·  देर से जमा: ${s.lateCount} (₹${rupees(s.lateAmount)})  ·  समय निकल चुका बकाया: ${s.overdueCount} (₹${rupees(s.overdueAmount)})`,
      `समय पर = क्लोजिंग सूचना की अंतिम तिथि तक, या सूचना न हो तो क्लोजिंग के ${detail.graceDays} दिन के भीतर।`,
    ],
    landscape: true,
  }, `${m.registrationNumber || m.id}-${pick}.pdf`);
}
