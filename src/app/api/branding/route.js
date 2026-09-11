import { db } from '../../../server/firebase/admin.js';
import { handler, okCached } from '../../../server/http.js';
import { resolveTrustId } from '../../../server/domain/trustId.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../../lib/theme.js';

/**
 * GET /api/branding — the trust's public face, without signing in.
 *
 * Deliberately unauthenticated, and deliberately tiny: the name, the logo and
 * the two theme colours. Nothing here is private — it is printed across the
 * top of every receipt the trust hands out — and the login screen needs it
 * before anyone has a session, otherwise the first page a person sees is the
 * only unbranded one.
 *
 * Everything else about the trust stays behind `/api/trust`, which requires a
 * session. The split matters: it is easy to "just return the trust document"
 * here and quietly publish the registration number, the phone list and the
 * signatory's name to anyone who guesses the URL.
 */
export const GET = handler(async () => {
  // Same resolver the rest of the app uses, so the login screen cannot end
  // up branded from a different trust than the one people sign in to.
  const trustId = await resolveTrustId();

  const fallback = {
    nameHi: 'ट्रस्ट प्रबंधन',
    nameEn: '',
    tagline: '',
    logoURL: '',
    theme: { primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT },
  };

  if (!trustId) return okCached({ branding: fallback }, 60);

  const snap = await db.doc(`trusts/${trustId}`).get();
  if (!snap.exists) return okCached({ branding: fallback }, 60);

  const b = snap.data().branding ?? {};

  return okCached(
    {
      branding: {
        nameHi: b.nameHi || snap.data().name || fallback.nameHi,
        nameEn: b.nameEn ?? '',
        tagline: b.tagline ?? '',
        logoURL: b.logoURL ?? '',
        theme: {
          primary: b.theme?.primary || DEFAULT_PRIMARY,
          accent: b.theme?.accent || DEFAULT_ACCENT,
        },
      },
    },
    // Five minutes. Colours change about once in the life of a trust, and the
    // settings screen invalidates the client cache on save anyway.
    300,
  );
});
