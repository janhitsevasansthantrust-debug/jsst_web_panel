import { handler, ok } from '../../../server/http.js';

/**
 * GET /api/health — liveness probe. No auth, no database.
 * Also the quickest way to confirm the server-only env vars are loaded.
 */
export const GET = handler(async () =>
  ok({
    status: 'up',
    at: new Date().toISOString(),
    env: {
      firebaseAdmin: Boolean(
        process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY,
      ),
      firebaseClient: Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
      setupEnabled: Boolean(process.env.SETUP_SECRET),
    },
  }),
);
