import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { collectionReport } from '../../../../server/domain/collectionReport.js';
import { ROLE } from '../../../../config/constants.js';

export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const filters = Object.fromEntries(new URL(request.url).searchParams);
  const report = await collectionReport(scope, filters);
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(filters.limit) || 50)));
  return ok({ ...report, total: report.rows.length, page,
    rows: report.rows.slice((page - 1) * limit, page * limit) });
});
