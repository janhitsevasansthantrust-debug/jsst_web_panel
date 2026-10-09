import { handler } from '../../../../../../server/http.js';
import { requireScope } from '../../../../../../server/auth/session.js';
import { getAgentBatch, getAgentOverview } from '../../../../../../server/domain/agentApp.js';
import { getTrust } from '../../../../../../server/domain/trust.js';
import { tablePdfResponse, rupees, dmy } from '../../../../../../server/pdf/respond.js';
import { ROLE } from '../../../../../../config/constants.js';

/**
 * GET /api/agent/batches/[id]/pdf?mode=pending|paid|all — the agent's sheet for
 * one क्लोजिंग समूह: each member and what they owe across all its closings.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  const raw = new URL(request.url).searchParams.get('mode');
  const mode = ['paid', 'all'].includes(raw) ? raw : 'pending';

  const [data, trust, overview] = await Promise.all([
    getAgentBatch(scope, id),
    getTrust(scope),
    getAgentOverview(scope),
  ]);
  const rows = data.rows.filter((r) => (mode === 'all' ? true : mode === 'paid' ? r.remaining <= 0 : r.remaining > 0));
  const label = mode === 'paid' ? 'जमा सूची' : mode === 'all' ? 'पूरी सूची' : 'बकाया सूची';
  const b = data.batch;
  const program = overview.programs.find((p) => p.id === scope.programId);

  return tablePdfResponse({
    trust,
    title: `${b.name} — ${label}`,
    lines: [
      `क्लोजिंग: ${data.closings.map((c) => `#${c.seq} ${c.name}`).join(', ')}`,
      `${b.dueDateMs ? `अंतिम तिथि ${dmy(b.dueDateMs)}  ·  ` : ''}एजेंट: ${overview.agent.displayName}${overview.agent.phone ? ` (${overview.agent.phone})` : ''}${program ? `  ·  योजना: ${program.name}` : ''}`,
    ],
    columns: [
      { key: 'n', header: 'क्र.', width: 4, align: 'center' },
      { key: 'reg', header: 'रजि.', width: 7 },
      { key: 'name', header: 'नाम', width: 17 },
      { key: 'father', header: 'पिता/पति', width: 14 },
      { key: 'village', header: 'गाँव', width: 10 },
      { key: 'phone', header: 'मोबाइल', width: 11 },
      { key: 'cl', header: 'क्लो.', width: 5, align: 'center' },
      { key: 'amount', header: 'राशि', width: 8, align: 'right' },
      { key: 'paid', header: 'जमा', width: 8, align: 'right' },
      { key: 'left', header: 'बाकी', width: 8, align: 'right' },
    ],
    rows: rows.map((r, i) => ({
      n: i + 1, reg: r.registrationNumber, name: r.displayName, father: r.fatherName,
      village: r.village, phone: r.phone, cl: `${r.pendingClosings}/${r.closings}`,
      amount: rupees(r.amount), paid: rupees(r.paid), left: rupees(r.remaining),
    })),
    totals: [
      `इस सूची में: ${rows.length} सदस्य  ·  राशि ₹${rupees(rows.reduce((t, r) => t + r.amount, 0))}  ·  जमा ₹${rupees(rows.reduce((t, r) => t + r.paid, 0))}  ·  बाकी ₹${rupees(rows.reduce((t, r) => t + r.remaining, 0))}`,
      `इस समूह में आपके कुल ${data.totals.members} सदस्य — पूरा जमा ${data.totals.paidMembers}, बकाया ${data.totals.pendingMembers} (₹${rupees(data.totals.pendingAmount)})`,
    ],
  }, `batch-${b.code || id}-${mode}.pdf`);
});
