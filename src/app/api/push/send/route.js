import { z } from 'zod';

import { handler, ok, readBody } from '../../../../server/http.js';
import { requireRole } from '../../../../server/auth/session.js';
import { deviceCounts, notify, sentList } from '../../../../server/domain/push.js';
import { ROLE } from '../../../../config/constants.js';

const body = z.object({
  title: z.string().trim().min(2, 'शीर्षक लिखें').max(120),
  body: z.string().trim().max(1000).optional().default(''),
  audience: z.enum(['all', 'members', 'agents', 'program']),
  programId: z.string().optional(),
  url: z.string().trim().max(200).optional(),
});

/** GET /api/push/send — the office screen: devices registered + what was sent. */
export const GET = handler(async () => {
  const scope = await requireRole(ROLE.ADMIN);
  const [counts, sent] = await Promise.all([deviceCounts(scope.trustId), sentList(scope.trustId)]);
  return ok({ counts, sent });
});

/** POST /api/push/send — a notification to every member / agent / one योजना. */
export const POST = handler(async (request) => {
  const scope = await requireRole(ROLE.ADMIN);
  const b = await readBody(request, body);
  const audience = b.audience === 'all' ? { all: true }
    : b.audience === 'members' ? { role: 'member' }
      : b.audience === 'agents' ? { role: 'agent' }
        : { programId: b.programId };
  const result = await notify(scope.trustId, audience, { title: b.title, body: b.body, url: b.url, kind: 'broadcast' }, {
    strict: true, sentBy: scope.name || scope.email || scope.uid,
  });
  return ok({ result });
});
