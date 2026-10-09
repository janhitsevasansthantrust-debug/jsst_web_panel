import { MEMBER_STATUS, LIMITS, CLOSING_STATUS } from '../config/constants.js';
import { computeDue } from '../server/domain/ledger.js';
import { fromMemberEntry } from '../server/domain/indexEntry.js';

/**
 * Who is billed for a क्लोजिंग समूह, and for which of its closings.
 *
 * One receipt per member, listing the closings in the batch that THAT member
 * owes — not the whole batch. The difference matters and is easy to miss: a
 * member who joined on the 15th owes the closings from the 15th onwards and
 * none of the earlier ones, so their sheet is shorter and their total smaller.
 * Printing the batch's full list on every receipt would over-bill exactly the
 * people who joined most recently, which is the group least able to argue.
 *
 * Pure, and reading from the shared member index, so billing a batch for a
 * 5,000-member trust costs no reads at all.
 */

/**
 * @param items     member index entries (short keys)
 * @param closings  the batch's closings, oldest first
 * @param opts.programId
 * @param opts.agentId   only this agent's members — how receipts are handed out
 * @returns bills, one per member, in registration-number order
 */
export function billBatch(items, closings, { programId, agentId } = {}) {
  const live = (closings ?? []).filter((c) => c.status !== CLOSING_STATUS.REVERTED);

  const bills = [];

  for (const m of items ?? []) {
    if (programId && m.pid !== programId) continue;
    if (agentId && m.agentId !== agentId) continue;

    const due = computeDue(fromMemberEntry(m), live);
    const owed = due.dueItems.map((item) => ({
      ...live.find((c) => c.seq === item.seq),
      remaining: item.remaining, alreadyPaid: item.alreadyPaid,
    }));

    if (!owed.length) continue;

    const rate = Number(m.pay) > 0 ? Number(m.pay) : LIMITS.DEFAULT_PAY_AMOUNT;

    bills.push({
      member: {
        id: m.id,
        regNo: m.reg ?? '',
        name: m.name ?? '',
        fatherName: m.father ?? '',
        phone: m.phone ?? '',
        village: m.village ?? '',
        district: m.dist ?? '',
        ageBand: m.ageBand ?? '',
        agentId: m.agentId ?? null,
        agentName: m.agent ?? '',
        /** Everything they owe across ALL closings, not just this batch. */
        totalDue: Number(m.due) || 0,
      },
      rate,
      closings: owed,
      count: owed.length,
      total: due.dueAmount,
    });
  }

  return bills.sort(byRegNo);
}

/**
 * The bills grouped by the agent who will hand them out, each with its totals.
 *
 * This is the summary sheet: the agent takes a stack of receipts and one page
 * saying what the stack should add up to when they come back.
 */
export function groupBillsByAgent(bills) {
  const groups = new Map();

  for (const bill of bills) {
    const key = bill.member.agentId ?? '';
    const group = groups.get(key) ?? {
      agentId: bill.member.agentId ?? null,
      // A member added by the office has no agent. Saying so beats a blank,
      // which reads as a name that failed to load.
      agentName: bill.member.agentName || 'कार्यालय से जोड़े गए',
      bills: [],
      memberCount: 0,
      closingCount: 0,
      total: 0,
      totalDue: 0,
    };

    group.bills.push(bill);
    group.memberCount += 1;
    group.closingCount += bill.count;
    group.total += bill.total;
    group.totalDue += bill.member.totalDue;

    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) =>
    String(a.agentName).localeCompare(String(b.agentName)),
  );
}

/** What a whole run of receipts comes to. */
export function summariseBills(bills) {
  return {
    memberCount: bills.length,
    closingCount: bills.reduce((s, b) => s + b.count, 0),
    total: bills.reduce((s, b) => s + b.total, 0),
    totalDue: bills.reduce((s, b) => s + b.member.totalDue, 0),
  };
}

/**
 * Registration numbers sort as numbers where they are numbers.
 *
 * `V100151` and `V10099` are the wrong way round under a plain string compare,
 * and a receipt stack out of register order is a stack somebody re-sorts by
 * hand before walking the village.
 */
function byRegNo(a, b) {
  const A = String(a.member.regNo ?? '');
  const B = String(b.member.regNo ?? '');

  const na = Number(A.replace(/\D+/g, ''));
  const nb = Number(B.replace(/\D+/g, ''));

  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return A.localeCompare(B);
}
