import 'server-only';

import { getClosingsIndex, getMembersIndex, fromMemberEntry } from './indexes.js';
import { computeDue, isEligible, amountFor } from './ledger.js';
import { selectClosings } from '../../lib/closingSelection.js';
import { ROLE } from '../../config/constants.js';
import { forbidden } from '../errors.js';

/** Derived, filtered ledger rows. No member × closing documents are written. */
export async function collectionReport(scope, filters = {}) {
  if (scope.role === ROLE.AGENT && !scope.agentId) throw forbidden();
  const [index, members] = await Promise.all([
    getClosingsIndex(scope.trustId, scope.programId),
    getMembersIndex(scope.trustId),
  ]);
  const closings = selectClosings(index.items, filters).filter((c) => c.status === 'active');
  const agentId = scope.role === ROLE.AGENT ? scope.agentId : filters.agentId;
  const q = String(filters.q ?? '').trim().toLowerCase();
  const rows = [];
  for (const entry of members.items) {
    if (entry.pid !== scope.programId || (agentId && entry.agentId !== agentId)) continue;
    const member = fromMemberEntry(entry);
    if (filters.memberId && member.id !== filters.memberId) continue;
    if (q && ![entry.name, entry.reg, entry.phone, entry.village].some((v) => String(v).toLowerCase().includes(q))) continue;
    const eligible = closings.filter((c) => isEligible(member, c));
    if (!eligible.length) continue;
    const due = computeDue(member, eligible);
    const items = eligible.map((c) => {
      const pending = due.dueItems.find((d) => d.seq === c.seq);
      const exempt = (member.exemptSeqs ?? []).includes(c.seq);
      const amount = amountFor(member, c);
      return { ...c, amount, remaining: pending?.remaining ?? 0,
        paid: exempt ? 0 : pending ? pending.alreadyPaid : amount,
        status: exempt ? 'exempt' : pending ? pending.partial ? 'partial' : 'pending' : 'paid' };
    });
    rows.push({ ...member, items, dueCount: due.dueCount, dueAmount: due.dueAmount,
      selectedPaid: items.reduce((sum, item) => sum + item.paid, 0),
      selectedAmount: items.reduce((sum, item) => sum + item.amount, 0) });
  }
  return { closings, rows, totals: {
    members: rows.length,
    dueAmount: rows.reduce((sum, r) => sum + r.dueAmount, 0),
    paidAmount: rows.reduce((sum, r) => sum + r.selectedPaid, 0),
    amount: rows.reduce((sum, r) => sum + r.selectedAmount, 0),
  } };
}
