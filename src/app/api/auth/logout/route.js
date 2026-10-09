import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '../../../../config/constants.js';

/**
 * GET /api/auth/logout — clear a dead session cookie, then go to /login.
 *
 * This exists to break a redirect loop, and the reason is worth stating.
 *
 * A session cookie can be PRESENT but INVALID — expired, or revoked (which is
 * exactly what `create-owner` does via `revokeRefreshTokens` after writing new
 * claims). Proxy runs on the Edge and cannot verify a Firebase cookie, so it
 * only sees "a cookie exists". The admin layout CAN verify it, finds it dead,
 * and redirects to /login. If proxy then bounces cookie-holders away from
 * /login, the two rules chase each other forever: ERR_TOO_MANY_REDIRECTS.
 *
 * The fix is to actually REMOVE the dead cookie, which only a route handler
 * can do — cookies cannot be mutated while a server component renders. So the
 * layout redirects here instead of to /login directly, and after this runs the
 * browser genuinely has no session and the normal signed-out path applies.
 *
 * Deliberately does not call `revokeRefreshTokens`: the session is already
 * invalid, and a network round-trip to Firebase would slow down a redirect
 * that exists purely to unstick the user.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next');

  // Each phone app has its own sign-in screen; send people back to theirs.
  const loginPath = next && /^\/agent(\/|$)/.test(next)
    ? '/agent/login'
    : next && /^\/member(\/|$)/.test(next)
      ? '/member/login'
      : '/login';
  const target = new URL(loginPath, url.origin);
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    target.searchParams.set('next', next);
  }
  target.searchParams.set('stale', '1');

  const response = NextResponse.redirect(target);
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
