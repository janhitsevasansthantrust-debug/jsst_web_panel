import { redirect } from 'next/navigation';

import AppShell from '../../components/shell/AppShell.js';
import { getSession } from '../../server/auth/session.js';

/**
 * The signed-in shell.
 *
 * The session is verified HERE, on the server, before a single byte of the
 * admin UI is sent. Proxy's cookie check is only an optimisation; this is the
 * boundary that actually holds.
 *
 * When the cookie turns out to be dead we redirect to /api/auth/logout rather
 * than straight to /login. A server component cannot delete a cookie while it
 * renders, so redirecting to /login would leave the dead cookie in place — and
 * anything that treats "cookie present" as "signed in" would send the browser
 * straight back here. That is the ERR_TOO_MANY_REDIRECTS loop. The logout
 * route can actually clear it, so the user lands on a genuinely signed-out
 * login page instead of ping-ponging.
 */
export default async function AdminLayout({ children }) {
  const session = await getSession();

  if (!session) redirect('/api/auth/logout');
  // A member's place is the member app; the office panel has nothing for them.
  // Only an EXPLICIT member claim: an account with no claims at all may be a
  // new owner on their way to /setup.
  if (session.roleClaim === 'member') redirect('/member');
  if (!session.trustId) redirect('/setup');

  return <AppShell user={session}>{children}</AppShell>;
}
