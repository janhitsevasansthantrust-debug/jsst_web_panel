/**
 * Where each kind of account lands after signing in.
 *
 * Members and agents each have their own phone app; staff get the office
 * panel. An agent may still open the office panel (it is scoped to them), but
 * the app is their home.
 */
export function homeForRole(role) {
  if (role === 'member') return '/member';
  if (role === 'agent') return '/agent';
  return '/dashboard';
}

/** Is `next` a safe in-app path that this role may be sent to? */
export function safeNext(next, role) {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  const isMemberApp = next === '/member' || next.startsWith('/member/');
  const isAgentApp = next === '/agent' || next.startsWith('/agent/');
  if (role === 'member') return isMemberApp ? next : null;
  if (role === 'agent') return isMemberApp ? null : next;
  return isMemberApp || isAgentApp ? null : next;
}
