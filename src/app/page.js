import { redirect } from 'next/navigation';

/**
 * `/` is not a screen. Proxy has already bounced signed-out visitors to
 * /login, so anyone reaching here has a session cookie.
 */
export default function Home() {
  redirect('/dashboard');
}
