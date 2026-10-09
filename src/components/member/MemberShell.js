'use client';

import MobileShell from '../mobile/MobileShell.js';

/**
 * The member app's frame: the same header as the agent app, no tab bar — a
 * member has one home (their family) and one place to go from it (a member).
 */
export default function MemberShell({ children, ...props }) {
  return (
    <MobileShell loginPath="/member/login" {...props}>
      {children}
    </MobileShell>
  );
}
