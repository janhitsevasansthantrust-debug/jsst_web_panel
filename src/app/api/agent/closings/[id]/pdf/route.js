import { handler } from '../../../../../../server/http.js';
import { requireScope } from '../../../../../../server/auth/session.js';
import { getAgentClosingMembers, getAgentOverview } from '../../../../../../server/domain/agentApp.js';
import { getTrust } from '../../../../../../server/domain/trust.js';
import { tablePdfResponse, rupees, dmy } from '../../../../../../server/pdf/respond.js';
import { ROLE } from '../../../../../../config/constants.js';

/**
 * GET /api/agent/closings/[id]/pdf?mode=pending|paid|all
 *
 * The sheet an agent carries on their round: for one closing, which of their
 * members still owe it (and how much), or who has already paid.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  const raw = new URL(request.url).searchParams.get('mode');
  const mode = ['paid', 'all'].includes(raw) ? raw : 'pending';

  const [data, trust, overview] = await Promise.all([
    getAgentClosingMembers(scope, id),
    getTrust(scope),
    getAgentOverview(scope),
  ]);

  const rows = data.rows.filter((r) => (mode === 'all' ? true : mode === 'paid' ? r.remaining <= 0 : r.remaining > 0));
  const label = mode === 'paid' ? 'जमा सूची' : mode === 'all' ? 'पूरी सूची' : 'बकाया सूची';
  const c = data.closing;
  const program = overview.programs.find((p) => p.id === scope.programId);

  return tablePdfResponse({
    trust,
    title: `क्लोजिंग ${label}`,
    lines: [
      `क्लोजिंग #${c.seq}: ${c.name}${c.regNo ? ` (रजि. ${c.regNo})` : ''}${c.village ? `, ${c.village}` : ''}  ·  दिनांक ${dmy(c.dateMs)}`,
      `एजेंट: ${overview.agent.displayName}${overview.agent.phone ? ` (${overview.agent.phone})` : ''}${program ? `  ·  योजना: ${program.name}` : ''}`,
    ],
    columns: [
      { key: 'n', header: 'क्र.', width: 4, align: 'center' },
      { key: 'reg', header: 'रजि.', width: 7 },
      { key: 'name', header: 'नाम', width: 18 },
      { key: 'father', header: 'पिता/पति', width: 15 },
      { key: 'village', header: 'गाँव', width: 11 },
      { key: 'phone', header: 'मोबाइल', width: 11 },
      { key: 'amount', header: 'राशि', width: 7, align: 'right' },
      { key: 'paid', header: 'जमा', width: 7, align: 'right' },
      { key: 'left', header: 'बाकी', width: 7, align: 'right' },
      { key: 'allDue', header: 'कुल बकाया', width: 9, align: 'right' },
    ],
    rows: rows.map((r, i) => ({
      n: i + 1,
      reg: r.registrationNumber,
      name: r.displayName,
      father: r.fatherName,
      village: r.village,
      phone: r.phone,
      amount: rupees(r.amount),
      paid: rupees(r.paid),
      left: rupees(r.remaining),
      allDue: rupees(r.totalDueAmount),
    })),
    totals: [
      `इस सूची में: ${rows.length} सदस्य  ·  राशि ₹${rupees(rows.reduce((t, r) => t + r.amount, 0))}  ·  जमा ₹${rupees(rows.reduce((t, r) => t + r.paid, 0))}  ·  बाकी ₹${rupees(rows.reduce((t, r) => t + r.remaining, 0))}`,
      `इस क्लोजिंग में आपके कुल ${data.totals.members} सदस्य — जमा ${data.totals.paidCount} (₹${rupees(data.totals.paidAmount)}), बकाया ${data.totals.pendingCount} (₹${rupees(data.totals.pendingAmount)})`,
    ],
  }, `closing-${c.seq}-${mode}.pdf`);
});
