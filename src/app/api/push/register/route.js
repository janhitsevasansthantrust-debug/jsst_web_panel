import { z } from 'zod';

import { handler, ok, readBody } from '../../../../server/http.js';
import { requireSession } from '../../../../server/auth/session.js';
import { registerToken, unregisterToken } from '../../../../server/domain/push.js';

const body = z.object({
  token: z.string().min(20).max(4096),
  platform: z.string().max(20).optional(),
  appVersion: z.string().max(20).optional(),
  lang: z.string().max(5).optional(),
});

/** POST /api/push/register — the phone's FCM token, after login (agent or member). */
export const POST = handler(async (request) => {
  const session = await requireSession();
  return ok(await registerToken(session, await readBody(request, body)));
});

/** DELETE /api/push/register — on logout, so this phone stops getting this person's notifications. */
export const DELETE = handler(async (request) => {
  const session = await requireSession();
  const { token } = await readBody(request, z.object({ token: z.string().max(4096) }));
  return ok(await unregisterToken(session, token));
});
