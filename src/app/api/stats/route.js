import { handler, okCached } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { getStats, recomputeStats } from '../../../server/domain/members.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/stats — the entire dashboard.
 *
 * ONE Firestore document read.
 *
 * For comparison, the old `/api/payments/fetch` built this same screen by
 * reading the whole `payment_pending` collection plus the whole `transactions`
 * collection — roughly 2.5 million documents at target scale, about $1.50 per
 * page load, every single load.
 *
 * `?recompute=true` (admin only) rebuilds the counters from scratch using
 * aggregation queries, which heals any drift. Firestore charges a `count()` as
 * a handful of reads regardless of how many documents match, so even a full
 * recount is nearly free. Run it nightly.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const recompute =
    new URL(request.url).searchParams.get('recompute') === 'true';

  if (recompute && (scope.role === ROLE.ADMIN || scope.role === ROLE.OWNER)) {
    const stats = await recomputeStats(scope);
    return okCached({ stats }, 0);
  }

  const stats = await getStats(scope);
  return okCached({ stats }, 30);
});
