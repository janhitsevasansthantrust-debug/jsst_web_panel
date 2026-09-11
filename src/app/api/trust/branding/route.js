import crypto from 'node:crypto';

import { handler, ok, badRequest, tooLarge } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { adminStorage } from '../../../../server/firebase/admin.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * POST /api/trust/branding — upload a logo, seal, signature, header or banner.
 *
 * Everything else in this app that takes an image (member photos, agent
 * signatures, ID documents) uploads straight from the browser to Firebase
 * Storage, and that is the right call there: a 6 MB phone photo has no
 * business travelling through a route handler.
 *
 * Branding is the exception, for two reasons.
 *
 * The first is that it kept failing. A browser upload is governed by Storage
 * rules, which live in a file that has to be deployed separately from the app;
 * until that deploy happens the settings screen answers `storage/unauthorized`
 * and there is nothing in the running code to fix. A trust setting itself up
 * for the first time should not need a second deployment step to get its own
 * logo onto its own receipts.
 *
 * The second is that these six images are not like the others. They are the
 * trust's identity on every printed document, there is exactly one of each,
 * and replacing one is an administrative act. That deserves a check made
 * against the session cookie — which is verified server-side and cannot be
 * stale — rather than against a custom claim in whatever ID token the browser
 * happens to be holding.
 *
 * They are also small: PhotoUpload downscales to 1200px / ~200 KB before
 * sending, so the objection that started this comment does not apply.
 */

const MAX_BYTES = 3 * 1024 * 1024;

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Which branding slot this is — also the folder, so nothing else can be written. */
const KINDS = new Set(['logo', 'seal', 'sign', 'header', 'banner']);

export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);

  const form = await request.formData().catch(() => null);
  if (!form) throw badRequest('फ़ाइल नहीं मिली');

  const kind = String(form.get('kind') ?? '');
  if (!KINDS.has(kind)) throw badRequest('अज्ञात चित्र प्रकार');

  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw badRequest('फ़ाइल नहीं मिली');
  }

  const ext = TYPES[file.type];
  if (!ext) throw badRequest('सिर्फ़ JPG, PNG या WebP चित्र चलेंगे');

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) throw badRequest('फ़ाइल खाली है');
  if (bytes.length > MAX_BYTES) {
    throw tooLarge('चित्र 3MB से बड़ा है — छोटा करके भेजें');
  }

  const bucket = adminStorage.bucket();
  const name = `trusts/${scope.trustId}/branding/${kind}-${Date.now()}.${ext}`;

  /**
   * The download token is what makes the object readable without a signed URL
   * and without a read rule. It is the same mechanism `getDownloadURL()` uses
   * on the client, and it matters here because these images are fetched by the
   * PDF renderer — which is a plain HTTP GET with no Firebase session — and by
   * the login screen, which has no session at all.
   *
   * A signed URL would have been the obvious alternative and is the wrong one:
   * V4 signing caps at seven days, so every receipt printed a week later would
   * head itself with a broken image.
   */
  const token = crypto.randomUUID();

  await bucket.file(name).save(bytes, {
    resumable: false,
    contentType: file.type,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const url =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
    `/o/${encodeURIComponent(name)}?alt=media&token=${token}`;

  // The URL is returned, not saved: the settings form holds it until the admin
  // presses Save, so abandoning a half-finished edit does not change what is
  // printed on tomorrow's receipts.
  return ok({ url });
});
