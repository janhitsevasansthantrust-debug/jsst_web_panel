import { z } from 'zod';

import {
  handler, ok, readBody, forbidden, conflict, unauthorized,
} from '../../../server/http.js';
import { getSession, setUserClaims } from '../../../server/auth/session.js';
import { createTrust, countTrusts } from '../../../server/domain/bootstrap.js';
import { ROLE } from '../../../config/constants.js';

const setupSchema = z.object({
  secret: z.string().min(1),
  trustName: z.string().trim().min(2).max(200),
  trustNameEn: z.string().trim().max(200).optional().default(''),
  programName: z.string().trim().min(2).max(200).default('मुख्य योजना'),
  payAmount: z.coerce.number().min(1).max(100000).default(200),
  joinFees: z.coerce.number().min(0).max(1000000).default(0),
  receiptPrefix: z.string().trim().max(8).optional().default('RSD'),
});

/**
 * POST /api/setup — create THE trust, once.
 *
 * This system serves one trust. This endpoint exists for the single moment
 * before that trust exists: a signed-in account with no `trustId` claim
 * creating it. Afterwards it refuses, and with `TRUST_ID` set `createTrust`
 * refuses too, so there is no path to a second trust in this database.
 *
 * The other way in — the one that works when nobody can sign in yet — is
 * `npm run create-owner`, which also creates the Firebase Auth account. Both
 * call `createTrust()`, so a trust made either way is identical.
 *
 * Both paths call `createTrust()`, so a trust made either way is identical.
 *
 * Gated on SETUP_SECRET so a member cannot mint themselves a trust. Delete the
 * variable once your trust exists and this endpoint turns itself off.
 */
export const POST = handler(async (request) => {
  const session = await getSession();
  if (!session) {
    throw unauthorized(
      'Sign in first. If no account exists yet, run: npm run create-owner',
    );
  }

  const input = await readBody(request, setupSchema);

  const expected = process.env.SETUP_SECRET;
  if (!expected) {
    throw forbidden(
      'Setup is disabled. Set SETUP_SECRET in .env.local, or run: npm run create-owner',
    );
  }
  if (input.secret !== expected) {
    throw forbidden('Setup secret does not match');
  }
  if (session.trustId) {
    throw conflict('This account already belongs to a trust', {
      trustId: session.trustId,
    });
  }

  const existing = await countTrusts();

  const { trustId, programId } = await createTrust({
    uid: session.uid,
    email: session.email,
    name: session.name,
    input,
  });

  await setUserClaims(session.uid, {
    role: ROLE.OWNER,
    trustId,
    programId,
  });

  return ok(
    {
      trustId,
      programId,
      existingTrusts: existing,
      // Custom claims only appear in a NEW token, so the caller must refresh
      // and swap its session cookie before anything else will work.
      refreshRequired: true,
    },
    { status: 201 },
  );
});
