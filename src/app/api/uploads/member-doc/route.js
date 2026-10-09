import crypto from 'node:crypto';

import { handler, ok, badRequest, tooLarge } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { adminStorage } from '../../../../server/firebase/admin.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * POST /api/uploads/member-doc — a member photo or document.
 *
 * Used by the phone app (which has no Firebase SDK — it signs in through
 * /api/auth/mobile) AND by the office forms. Going through the server means an
 * upload is checked against the session, not against Storage security rules —
 * rules are deployed separately, and until they are, a direct browser upload
 * fails with `storage/unauthorized` and nothing in the app can fix it.
 *
 * The file's kind is read from its first bytes, not from the declared type:
 * phones send `image/jpg`, an empty type or `application/octet-stream` for a
 * perfectly good JPEG, and refusing those was why "photo upload doesn't work".
 *
 * Form fields: `file` (required), `folder` = members | documents (optional).
 */
const MAX_BYTES = 10 * 1024 * 1024; // the proxy's request-body limit
const FOLDERS = new Set(['members', 'documents']);

export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') throw badRequest('फ़ाइल नहीं मिली — दोबारा चुनें');

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) throw badRequest('फ़ाइल खाली है');
  if (bytes.length > MAX_BYTES) throw tooLarge('फ़ाइल 10MB से बड़ी है — छोटी फोटो चुनें');

  const kind = sniff(bytes);
  if (!kind) {
    throw badRequest(/heic|heif/i.test(String(file.type) + String(file.name))
      ? 'HEIC फोटो नहीं चलेगी — कैमरा सेटिंग में "Most Compatible" (JPG) चुनें'
      : 'सिर्फ़ JPG, PNG, WebP फोटो या PDF चलेगी');
  }

  const folder = FOLDERS.has(String(form.get('folder'))) ? String(form.get('folder')) : 'members';
  const bucket = adminStorage.bucket();
  const name = `${folder}/${new Date().getFullYear()}/${scope.role}-${scope.uid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${kind.ext}`;
  const token = crypto.randomUUID();

  await bucket.file(name).save(bytes, {
    resumable: false,
    contentType: kind.type,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  return ok({
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(name)}?alt=media&token=${token}`,
    type: kind.type,
  });
});

/** What the file really is, from its magic bytes. */
function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  return null;
}
