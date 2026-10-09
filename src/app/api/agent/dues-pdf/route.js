import { handler } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getAgentOverview } from '../../../../server/domain/agentApp.js';
import { listMembersForExport } from '../../../../server/domain/members.js';
import { getTrust } from '../../../../server/domain/trust.js';
import { tablePdfResponse, rupees } from '../../../../server/pdf/respond.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/agent/dues-pdf?mode=pending|paid|fee
 *
 * The agent's whole list for the current योजना, as a portrait sheet that
 * prints on a phone's share-to-printer:
 *   pending — members who owe any closing, with how many and how much
 *   paid    — members who owe nothing
 *   fee     — members whose joining fee is still (partly) due
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const raw = new URL(request.url).searchParams.get('mode');
  const mode = ['paid', 'fee'].includes(raw) ? raw : 'pending';

  const filters = {
    agentId: [scope.agentId],
    sortBy: mode === 'pending' ? 'dueAmount' : 'registrationNumber',
    sortDir: mode === 'pending' ? 'desc' : 'asc',
    ...(mode === 'pending' ? { hasDue: true } : {}),
    ...(mode === 'paid' ? { hasDue: false } : {}),
    ...(mode === 'fee' ? { hasFeeDue: true } : {}),
  };

  const [{ members, totals }, trust, overview] = await Promise.all([
    listMembersForExport(scope, filters),
    getTrust(scope),
    getAgentOverview(scope),
  ]);
  const program = overview.programs.find((p) => p.id === scope.programId);
  const title = mode === 'paid' ? 'जमा सदस्य सूची' : mode === 'fee' ? 'नामांकन शुल्क बकाया सूची' : 'बकाया सदस्य सूची';

  const columns = [
    { key: 'n', header: 'क्र.', width: 4, align: 'center' },
    { key: 'reg', header: 'रजि.', width: 7 },
    { key: 'name', header: 'नाम', width: 18 },
    { key: 'father', header: 'पिता/पति', width: 15 },
    { key: 'village', header: 'गाँव', width: 11 },
    { key: 'phone', header: 'मोबाइल', width: 11 },
    ...(mode === 'fee'
      ? [
        { key: 'fee', header: 'शुल्क', width: 8, align: 'right' },
        { key: 'feePaid', header: 'जमा', width: 8, align: 'right' },
        { key: 'feeDue', header: 'बाकी', width: 8, align: 'right' },
      ]
      : [
        { key: 'dueC', header: 'बकाया क्लो.', width: 7, align: 'center' },
        { key: 'due', header: 'बकाया ₹', width: 8, align: 'right' },
        { key: 'paid', header: 'जमा ₹', width: 9, align: 'right' },
      ]),
  ];

  const sum = (f) => members.reduce((t, m) => t + (Number(f(m)) || 0), 0);

  return tablePdfResponse({
    trust,
    title,
    lines: [
      `एजेंट: ${overview.agent.displayName}${overview.agent.phone ? ` (${overview.agent.phone})` : ''}${program ? `  ·  योजना: ${program.name}` : ''}`,
    ],
    columns,
    rows: members.map((m, i) => ({
      n: i + 1,
      reg: m.registrationNumber,
      name: m.displayName,
      father: m.fatherName,
      village: m.village,
      phone: m.phone,
      dueC: m.dueCount ?? 0,
      due: rupees(m.dueAmount),
      paid: rupees(m.paidAmount),
      fee: rupees(m.joinFees),
      feePaid: rupees(m.joinFeesPaid),
      feeDue: rupees(m.joinFeesDue),
    })),
    totals: mode === 'fee'
      ? [`${members.length} सदस्य  ·  कुल शुल्क ₹${rupees(sum((m) => m.joinFees))}  ·  जमा ₹${rupees(sum((m) => m.joinFeesPaid))}  ·  बाकी ₹${rupees(sum((m) => m.joinFeesDue))}`]
      : [`${members.length} सदस्य  ·  कुल बकाया ₹${rupees(totals?.dueAmount ?? sum((m) => m.dueAmount))}  ·  कुल जमा ₹${rupees(totals?.paidAmount ?? sum((m) => m.paidAmount))}`],
  }, `agent-${mode}-list.pdf`);
});
