import { redirect } from 'next/navigation';
import Link from 'next/link';

import { getSession } from '../../../server/auth/session.js';
import ServiceWorker from '../../../components/mobile/ServiceWorker.js';

/**
 * The agent app's guard — verified on the server before anything renders.
 *
 * A member is sent to the member app. Office staff are told this is the
 * agent's app rather than being shown an agent's screens with nothing in them.
 */
export default async function AgentAppLayout({ children }) {
  const session = await getSession();
  if (!session) redirect('/api/auth/logout?next=/agent');
  if (session.roleClaim === 'member' || !session.roleClaim) redirect('/member');
  if (session.role !== 'agent') {
    return (
      <div className="m-login" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div className="m-card" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>यह एजेंट ऐप है</h2>
          <p className="m-muted">आप कार्यालय खाते से लॉगिन हैं। एजेंट ऐप एजेंट के अपने लॉगिन से खुलता है।</p>
          <Link href="/dashboard">कार्यालय पैनल खोलें →</Link>
        </div>
      </div>
    );
  }
  return (
    <>
      <ServiceWorker />
      {children}
    </>
  );
}
