import { db } from '../../../../server/firebase/admin.js';
import { handler, ok } from '../../../../server/http.js';
import { requireSession } from '../../../../server/auth/session.js';
import { aboutTrust } from '../../../../server/domain/appConfig.js';
import { paths } from '../../../../config/constants.js';

/**
 * GET /api/app/about — the trust's details and contact numbers for the app's
 * settings screen ("ट्रस्ट के बारे में", "संपर्क करें"), exactly as entered in
 * the office settings. Any signed-in person (agent or member) may read it —
 * it is the same information printed on every receipt.
 */
export const GET = handler(async () => {
  const session = await requireSession();
  const snap = await db.doc(paths.trust(session.trustId)).get();
  return ok({ about: aboutTrust(snap.exists ? snap.data() : {}) });
});
