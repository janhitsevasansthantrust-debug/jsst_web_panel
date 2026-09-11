import 'server-only';

import { db } from '../firebase/admin.js';

/**
 * Which trust this deployment serves — resolved once, then remembered.
 *
 * `TRUST_ID` pins the deployment to one trust. The first version of this
 * simply believed it, which broke every existing installation: a trust created
 * before the variable existed has an auto-generated id, so pinning it to
 * `main` pointed the whole app at `trusts/main`, which does not exist, and
 * every screen answered "ट्रस्ट नहीं मिला" while the real trust sat there
 * untouched.
 *
 * A setting that can silently point at nothing is not a safety feature. So the
 * pin is now CHECKED: if the pinned document exists it wins, and if it does
 * not, the deployment falls back to the trust that actually exists and says so
 * in the log — loudly enough to fix, quietly enough not to take the office
 * offline over a naming mismatch.
 *
 * One read, cached for the life of the process.
 */

const PINNED = (process.env.TRUST_ID ?? '').trim() || null;

/** Cached as a PROMISE so concurrent first requests share one read. */
let resolving = null;

export function pinnedTrustId() {
  return PINNED;
}

export async function resolveTrustId(claimTrustId = null) {
  if (!resolving) resolving = resolve(claimTrustId);

  const id = await resolving;
  // A miss must not be cached — the trust may be created a moment later by
  // `create-owner`, and a cached null would keep the app broken until restart.
  if (!id) resolving = null;

  return id ?? claimTrustId ?? null;
}

async function resolve(claimTrustId) {
  if (PINNED) {
    const snap = await db.doc(`trusts/${PINNED}`).get();
    if (snap.exists) return PINNED;
  }

  // The pin points at nothing. Prefer what the signed-in account says, since
  // that is the trust their data is actually in.
  if (claimTrustId) {
    const snap = await db.doc(`trusts/${claimTrustId}`).get();
    if (snap.exists) {
      warnMismatch(claimTrustId);
      return claimTrustId;
    }
  }

  // Neither. There is exactly one trust in a single-trust deployment, so find
  // it rather than failing over a name.
  const found = await db.collection('trusts').select().limit(2).get();
  if (found.size === 1) {
    const id = found.docs[0].id;
    warnMismatch(id);
    return id;
  }

  return null;
}

let warned = false;

function warnMismatch(actualId) {
  if (warned || !PINNED) return;
  warned = true;

  console.warn(
    `\n⚠  TRUST_ID="${PINNED}" पर कोई ट्रस्ट नहीं है — असली ट्रस्ट "${actualId}" है।\n` +
    `   अभी ऐप "${actualId}" के साथ चल रहा है।\n` +
    `   .env.local में यह कर लें:  TRUST_ID=${actualId}\n` +
    '   (या TRUST_ID हटा दें — तब यह अपने-आप ढूँढ लेगा।)\n',
  );
}
