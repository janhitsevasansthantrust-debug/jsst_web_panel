import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from './config/constants.js';

/**
 * Proxy — what Next.js called Middleware before v16.
 *
 * This is an OPTIMISTIC check only: it looks for the PRESENCE of a session
 * cookie so signed-out visitors get bounced to /login without a round-trip.
 * It deliberately does NOT verify the cookie — proxy runs on the Edge runtime
 * where firebase-admin cannot run, and a redirect is not a security boundary.
 *
 * Real authorisation happens in every route handler and server component via
 * `requireSession` / `requireScope`, which verify the cookie against Firebase
 * and check the caller's role and trust. Never rely on this file for access
 * control.
 *
 * ─── Why there is no "signed in → skip /login" redirect ──────────────────
 *
 * There used to be one, and it caused ERR_TOO_MANY_REDIRECTS.
 *
 * A cookie can be PRESENT but INVALID — expired, or revoked (which is exactly
 * what happens when `create-owner` runs `revokeRefreshTokens` after writing
 * new claims). With that combination:
 *
 *   /dashboard  → proxy sees a cookie, allows it
 *               → the layout verifies it, fails, redirects to /login
 *   /login      → proxy sees a cookie, redirects to /dashboard
 *               → …forever
 *
 * Proxy cannot tell a live cookie from a dead one, so it must not make
 * decisions that assume the cookie is good. Sending an already-signed-in user
 * to /login is harmless; the page itself forwards them on. A loop is not.
 */

const PUBLIC_PATHS = ['/login', '/forgot-password'];
const PUBLIC_API = [
  '/api/auth/session',
  '/api/auth/logout',
  '/api/health',
  // The trust's name, logo and two theme colours. The login screen needs them
  // before anyone has a session, or the first page a person sees is the only
  // unbranded one in the app. Nothing here is private — it is printed across
  // the top of every receipt the trust hands out.
  '/api/branding',
];

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();
    if (!hasSession) {
      return NextResponse.json(
        { ok: false, error: 'Not signed in', code: 'unauthorized' },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, static files and the favicon.
    '/((?!_next/static|_next/image|favicon.ico|fonts/|images/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|ttf|woff2?)$).*)',
  ],
};
