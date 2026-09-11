import 'server-only';

import { db, adminAuth, serverNow } from '../firebase/admin.js';
import { badRequest, conflict, notFound } from '../http.js';
import { setUserClaims } from '../auth/session.js';
import { ROLE, ROLE_RANK, paths } from '../../config/constants.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';

/**
 * trust.js — the trust itself, and the people who can sign in to it.
 *
 * This system runs ONE trust. There is no "create trust" here and no way to
 * switch between them: the trust exists before anyone logs in (created by
 * `npm run create-owner`), and everything below edits it in place.
 *
 * That is the fix for what the old settings screen did. Its "save organization"
 * button called `addDoc` on an `organizations` collection, so pressing save
 * twice left two organization records with no rule about which one was real —
 * and the PDF header then rendered from whichever came back first.
 */

/* ══════════════════════════════════════════════════════════════════════════
   The trust record
   ══════════════════════════════════════════════════════════════════════════ */

export async function getTrust(scope) {
  const snap = await db.doc(paths.trust(scope.trustId)).get();
  if (!snap.exists) throw notFound('ट्रस्ट नहीं मिला');

  const data = snap.data();
  return {
    id: snap.id,
    name: data.name ?? '',
    ownerUid: data.ownerUid ?? null,
    branding: { ...DEFAULT_BRANDING, ...(data.branding ?? {}) },
    createdAt: data.createdAt ?? null,
  };
}

/**
 * Sensible values for a field the trust has never filled in.
 *
 * Merged on read rather than written on create, so adding a branding field
 * later does not need a migration and does not leave old trusts with
 * `undefined` reaching a PDF renderer.
 */
const DEFAULT_BRANDING = {
  nameHi: '',
  nameEn: '',
  tagline: '',
  /** "राजस्थान-गुजरात" — the region the trust serves, printed under the name. */
  cityState: '',
  registrationNo: '',
  panNo: '',
  regDate: '',

  addressHi: '',
  city: '',
  district: '',
  state: '',
  pinCode: '',
  phone: [],
  email: '',
  website: '',
  /** Who to ask for, when the phone numbers reach an office. */
  contactPerson: '',

  logoURL: '',
  /** A second logo on the right of the header — a federation mark, usually. */
  rightLogoURL: '',
  /** A full-width band across the top, when the trust has artwork for it. */
  headerImageURL: '',
  bannerURL: '',
  sealURL: '',
  signatureURL: '',
  signatoryName: '',
  signatoryDesignation: 'अध्यक्ष',
  /** The president's name, when it differs from whoever signs. */
  presidentName: '',

  /**
   * Invocations printed ABOVE the trust's name — `|| श्री गणेशाय नमः ||` and
   * the like.
   *
   * Kept separate from `headerLines`, which sit BELOW the name and carry the
   * address and registration number. They are different lines in different
   * places doing different jobs, and folding them together would mean a trust
   * could not have one without the other.
   */
  topLines: [],

  headerLines: [],
  footerNote: '',
  terms: [],
  theme: { primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT },
  receiptPrefix: 'RSD',
  language: 'hi',
  showQR: false,
};

/**
 * Edit the trust. Merges into `branding` rather than replacing it, so a form
 * that only sends the fields it shows cannot wipe the ones it does not.
 */
export async function updateTrust(scope, patch) {
  const ref = db.doc(paths.trust(scope.trustId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('ट्रस्ट नहीं मिला');

  const branding = patch.branding ?? {};

  await ref.set(
    {
      ...(patch.name ? { name: patch.name } : {}),
      branding: {
        ...branding,
        ...(branding.theme
          ? { theme: { ...(snap.data().branding?.theme ?? {}), ...branding.theme } }
          : {}),
      },
      updatedAt: serverNow(),
      updatedBy: scope.uid,
    },
    { merge: true },
  );

  return getTrust(scope);
}

/* ══════════════════════════════════════════════════════════════════════════
   Team members — the people who sign in to the office side
   ══════════════════════════════════════════════════════════════════════════ */

export async function listTeam(scope) {
  const snap = await db.collection(paths.users(scope.trustId)).get();

  const users = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0));

  return { users };
}

/**
 * Add someone who can sign in.
 *
 * Creates the Firebase Auth account and the role claims together, the same way
 * `createAgent` does, and hands the password back exactly once. It is never
 * written to Firestore — Firebase hashes it, and a password sitting in a
 * document is a password that leaks with any read of that document. If it is
 * lost, the route is a reset, which is correct rather than inconvenient.
 */
export async function addTeamMember(scope, input) {
  if (rank(input.role) >= rank(scope.role)) {
    throw badRequest('आप अपने से बड़ी या बराबर भूमिका नहीं दे सकते');
  }

  const email = String(input.email).trim().toLowerCase();

  const existing = await adminAuth.getUserByEmail(email).catch(() => null);
  if (existing) {
    throw conflict('यह ईमेल पहले से इस्तेमाल में है', { email });
  }

  const password = input.password || generatePassword();

  const user = await adminAuth.createUser({
    email,
    password,
    displayName: input.name,
    emailVerified: false,
  });

  await setUserClaims(user.uid, {
    role: input.role,
    trustId: scope.trustId,
    programId: scope.programId,
  });

  const record = {
    uid: user.uid,
    email,
    name: input.name ?? '',
    designation: input.designation ?? '',
    phone: input.phone ?? '',
    photoURL: input.photoURL ?? '',
    role: input.role,
    active: true,
    createdAt: serverNow(),
    createdBy: scope.uid,
  };

  await db.doc(paths.user(scope.trustId, user.uid)).set(record);

  return { user: { id: user.uid, ...record }, password };
}

/**
 * Edit a team member, or switch their access off.
 *
 * Disabling sets `disabled` on the Auth account as well as `active` on the
 * document. Only the Auth flag actually stops a sign-in; the document flag is
 * what the screen reads. Setting one without the other is how someone stays
 * logged in after being "removed".
 */
export async function updateTeamMember(scope, uid, patch) {
  const ref = db.doc(paths.user(scope.trustId, uid));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('सदस्य नहीं मिला');

  const current = snap.data();

  if (current.role === ROLE.OWNER && scope.role !== ROLE.OWNER) {
    throw badRequest('मालिक का खाता सिर्फ़ मालिक ही बदल सकता है');
  }

  if (patch.role) {
    if (rank(patch.role) >= rank(scope.role) && scope.uid !== uid) {
      throw badRequest('आप अपने से बड़ी या बराबर भूमिका नहीं दे सकते');
    }
    if (current.role === ROLE.OWNER) {
      throw badRequest('मालिक की भूमिका नहीं बदली जा सकती');
    }
  }

  if (patch.active === false && current.role === ROLE.OWNER) {
    throw badRequest('मालिक का खाता बंद नहीं किया जा सकता');
  }

  if (patch.active === false && scope.uid === uid) {
    throw badRequest('आप अपना ही खाता बंद नहीं कर सकते');
  }

  const next = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.designation !== undefined ? { designation: patch.designation } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.photoURL !== undefined ? { photoURL: patch.photoURL } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    updatedAt: serverNow(),
    updatedBy: scope.uid,
  };

  await ref.set(next, { merge: true });

  if (patch.role !== undefined) {
    await setUserClaims(uid, {
      role: patch.role,
      trustId: scope.trustId,
      programId: scope.programId,
    });
  }

  if (patch.active !== undefined) {
    await adminAuth.updateUser(uid, { disabled: patch.active === false });
    // A disabled account keeps working until its session cookie expires.
    // Revoking makes it stop at the next request instead of up to two weeks
    // later, which is the only behaviour anyone expects from "बंद करें".
    if (patch.active === false) await adminAuth.revokeRefreshTokens(uid);
  }

  return { user: { id: uid, ...current, ...next } };
}

/** Issue a new password for a team member, shown once. */
export async function resetTeamPassword(scope, uid) {
  const snap = await db.doc(paths.user(scope.trustId, uid)).get();
  if (!snap.exists) throw notFound('सदस्य नहीं मिला');

  if (snap.data().role === ROLE.OWNER && scope.role !== ROLE.OWNER) {
    throw badRequest('मालिक का पासवर्ड सिर्फ़ मालिक ही बदल सकता है');
  }

  const password = generatePassword();
  await adminAuth.updateUser(uid, { password });
  await adminAuth.revokeRefreshTokens(uid);

  return { password };
}

const rank = (role) => ROLE_RANK[role] ?? 0;

/**
 * A password that is easy to read out over a phone and still hard to guess:
 * no look-alike characters, and a digit-and-symbol tail so it satisfies the
 * usual policies without anyone having to think about it.
 */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${out}@1`;
}
