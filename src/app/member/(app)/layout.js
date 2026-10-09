import { redirect } from 'next/navigation';

import { getSession } from '../../../server/auth/session.js';
import ServiceWorker from '../../../components/mobile/ServiceWorker.js';

/**
 * The member app's guard. Agents go to their own app and staff to the office
 * panel; anyone else signed in is treated as a member — including logins
 * carried over from the old app, which have no role claim at all.
 */
export default async function MemberAppLayout({ children }) {
  const session = await getSession();
  if (!session) redirect('/api/auth/logout?next=/member');
  if (session.roleClaim === 'agent') redirect('/agent');
  if (session.roleClaim && session.roleClaim !== 'member') redirect('/dashboard');
  return (
    <>
      <ServiceWorker />
      {children}
    </>
  );
}
