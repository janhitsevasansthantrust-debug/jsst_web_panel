/**
 * One deposit, many members, two kinds of debt.
 *
 * An agent walks in with ₹20,000 they have collected on their round and a list
 * of who it came from. Until now the only way to record that was to open each
 * member, tick their closings and submit — forty times, with the agent waiting.
 *
 * A member can owe two different things, and both are collected on the same
 * round out of the same pocket:
 *
 *   • the **joining fee**, owed from the day they enrolled, which may itself
 *     have been part-paid (₹2,100 of ₹11,000);
 *   • their **closings**, one per event they were eligible for.
 *
 * Treating those as separate errands is what made the counter slow. Here they
 * are one list of obligations per member, oldest first, and a deposit simply
 * runs down that list. The joining fee comes first for a member because it is
 * older than any closing they can owe — they could not have been eligible for
 * a closing before they joined.
 *
 * This is pure arithmetic over plain objects: no Firestore, no rounding
 * surprises, and the same function runs for the on-screen preview and for the
 * real posting, so what the operator approved is exactly what gets written.
 *
 * Two rules, because trusts genuinely do both:
 *
 *   'member'  — settle each member completely, in the order listed, until the
 *               money runs out. Produces whole receipts: most members are
 *               fully paid and at most ONE is left part-paid. This is the
 *               default, because a book full of part-payments is a book
 *               nobody can reconcile.
 *
 *   'oldest'  — pay the oldest obligation first across everybody, regardless
 *               of whose it is. Use when the trust's rule is that the oldest
 *               arrears clear first no matter who owes them.
 *
 * Neither rule ever allocates a paisa more than a member actually owes, and
 * what cannot be allocated comes back as `leftover` rather than disappearing.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Below this, treat the budget as spent — floating-point dust, not money. */
const EPSILON = 0.009;

/**
 * A member's debts as one ordered list.
 *
 * `seq: -1` for the joining fee is not a closing number — it is a sort key
 * that keeps the fee ahead of closing 1 when two obligations share a date, and
 * it is never written anywhere.
 */
function obligationsOf(row, include) {
  const list = [];

  if (include !== 'closings') {
    const fee = round2(row.joinFeeDue);
    if (fee > 0) {
      list.push({
        kind: 'fee',
        seq: -1,
        remaining: fee,
        dateMs: Number(row.joinDateMs) || 0,
      });
    }
  }

  if (include !== 'fees') {
    for (const d of row.due ?? []) {
      const remaining = round2(d.remaining);
      if (remaining > 0) {
        list.push({
          kind: 'closing',
          seq: d.seq,
          remaining,
          dateMs: Number(d.dateMs) || 0,
        });
      }
    }
  }

  return list.sort(byAge);
}

/**
 * Oldest first, and deterministic when they tie.
 *
 * Date alone is not enough: two closings can share a date, and an allocation
 * that comes out in a different order on the preview than on the posting is
 * not a preview. Sequence then member id break every tie, so the same inputs
 * always produce the same split.
 */
function byAge(a, b) {
  return (
    a.dateMs - b.dateMs ||
    a.seq - b.seq ||
    String(a.memberId ?? '').localeCompare(String(b.memberId ?? ''))
  );
}

/** A member row reduced to what the allocator needs. */
function prepare(rows, include) {
  return (rows ?? []).map((r) => {
    const items = obligationsOf(r, include);
    return {
      memberId: r.memberId,
      name: r.name ?? '',
      regNo: r.regNo ?? '',
      items,
      dueTotal: round2(items.reduce((s, i) => s + i.remaining, 0)),
    };
  });
}

/** Turn the picked obligations of one member into a payable line. */
function toLine(member, picked) {
  const amounts = {};
  const seqs = [];
  let joinFee = 0;
  let total = 0;

  for (const [item, amount] of picked) {
    if (item.kind === 'fee') joinFee = round2(joinFee + amount);
    else {
      amounts[item.seq] = round2((amounts[item.seq] ?? 0) + amount);
      if (!seqs.includes(item.seq)) seqs.push(item.seq);
    }
    total = round2(total + amount);
  }

  seqs.sort((a, b) => a - b);

  return {
    memberId: member.memberId,
    name: member.name,
    regNo: member.regNo,
    seqs,
    amounts,
    /** Of this line's total, how much goes to the joining fee. */
    joinFee,
    closingAmount: round2(total - joinFee),
    total,
    dueTotal: member.dueTotal,
    full: member.dueTotal > 0 && total >= member.dueTotal - EPSILON,
    partial: total > EPSILON && total < member.dueTotal - EPSILON,
  };
}

/**
 * @param {Array<{memberId:string, name?:string, regNo?:string,
 *                due?:Array<{seq:number, remaining:number, dateMs?:number}>,
 *                joinFeeDue?:number, joinDateMs?:number}>} rows
 * @param {number} amount        the deposit being split
 * @param {{rule?:'member'|'oldest',
 *          include?:'both'|'closings'|'fees'}} [opts]
 */
export function allocateDeposit(rows, amount, { rule = 'member', include = 'both' } = {}) {
  const members = prepare(rows, include);

  const dueTotal = round2(members.reduce((s, m) => s + m.dueTotal, 0));
  const budgetStart = round2(Math.max(0, amount));

  /** memberId → [[obligation, amount], …] */
  const picked = new Map(members.map((m) => [m.memberId, []]));
  let budget = budgetStart;

  const take = (memberId, item) => {
    if (budget <= EPSILON) return;
    const pay = round2(Math.min(budget, item.remaining));
    if (pay <= 0) return;
    picked.get(memberId).push([item, pay]);
    budget = round2(budget - pay);
  };

  if (rule === 'oldest') {
    // One queue across everybody. The member id rides along so a tie between
    // two people's obligations still resolves the same way every run.
    const queue = [];
    for (const m of members) {
      for (const item of m.items) queue.push({ ...item, memberId: m.memberId });
    }
    queue.sort(byAge);

    for (const item of queue) take(item.memberId, item);
  } else {
    // Member by member, and each member's own debts oldest first — which puts
    // their joining fee ahead of their closings.
    for (const m of members) {
      for (const item of m.items) take(m.memberId, item);
      if (budget <= EPSILON) break;
    }
  }

  const lines = members
    .map((m) => toLine(m, picked.get(m.memberId)))
    .filter((l) => l.total > 0);

  const allocated = round2(lines.reduce((s, l) => s + l.total, 0));

  return {
    rule,
    include,
    lines,
    allocated,
    /** Money that could not be placed — more was deposited than is owed. */
    leftover: round2(budgetStart - allocated),
    dueTotal,
    feeTotal: round2(lines.reduce((s, l) => s + l.joinFee, 0)),
    memberCount: lines.length,
    skipped: members.length - lines.length,
  };
}

/**
 * Turn an operator's hand-edited preview back into an allocation.
 *
 * The preview table lets each member's figure be overridden — the agent knows
 * Rameshwar handed over ₹400 and Kamla ₹800, and no rule can guess that. Each
 * edited total is then spread across that member's own obligations oldest
 * first, so the edit stays an amount the operator typed rather than a set of
 * closings they had to pick.
 *
 * @param {Array} rows                         same shape as allocateDeposit
 * @param {Record<string, number>} byMember    memberId → amount to take
 * @param {{include?:'both'|'closings'|'fees'}} [opts]
 */
export function allocateExplicit(rows, byMember, { include = 'both' } = {}) {
  const members = prepare(rows, include);
  const lines = [];

  for (const m of members) {
    const want = round2(byMember?.[m.memberId]);
    if (want <= 0) continue;

    let budget = round2(Math.min(want, m.dueTotal));
    const picked = [];

    for (const item of m.items) {
      if (budget <= EPSILON) break;
      const pay = round2(Math.min(budget, item.remaining));
      if (pay <= 0) continue;
      picked.push([item, pay]);
      budget = round2(budget - pay);
    }

    const line = toLine(m, picked);
    if (line.total > 0) {
      // They were offered more than they owe; the excess was not taken.
      line.refused = round2(Math.max(0, want - line.total));
      lines.push(line);
    }
  }

  const allocated = round2(lines.reduce((s, l) => s + l.total, 0));

  return {
    rule: 'explicit',
    include,
    lines,
    allocated,
    leftover: 0,
    dueTotal: round2(members.reduce((s, m) => s + m.dueTotal, 0)),
    feeTotal: round2(lines.reduce((s, l) => s + l.joinFee, 0)),
    memberCount: lines.length,
    skipped: members.length - lines.length,
  };
}
