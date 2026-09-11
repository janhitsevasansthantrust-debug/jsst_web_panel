'use client';

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';

/**
 * Firebase on the client — AUTH AND FILE UPLOADS ONLY.
 *
 * Note what is missing: Firestore.
 *
 * The old app initialised Firestore in the browser with a 100 MB persistent
 * cache and read collections directly from React components. That is what made
 * every screen re-download the world and what made the bill unpredictable —
 * a component that renders twice queries twice, and nobody can see it happen.
 *
 * In this system the browser never queries Firestore. Every list goes through a
 * Next.js route handler that can project fields, paginate, aggregate and cache
 * on the server, where the read count is visible and bounded.
 */

/**
 * `NEXT_PUBLIC_*` variables are inlined at BUILD time, so they must be read as
 * whole static expressions — `process.env[name]` in a loop would silently give
 * undefined. Hence the explicit list.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const ENV_NAMES = {
  apiKey: 'NEXT_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'NEXT_PUBLIC_FIREBASE_APP_ID',
};

export const missingEnv = Object.entries(ENV_NAMES)
  .filter(([key]) => !config[key])
  .map(([, name]) => name);

/**
 * Initialising Firebase with an empty apiKey throws at MODULE EVALUATION,
 * which takes the whole page down with an opaque `auth/invalid-api-key` and a
 * 500. Config problems should be diagnosable, so we detect the problem here
 * and let the UI render a message naming the exact variables.
 */
export const configError = missingEnv.length
  ? `Firebase config missing: ${missingEnv.join(', ')}`
  : null;

let app = null;
let auth = null;
let storage = null;

if (!configError) {
  app = getApps()[0] ?? initializeApp(config);
  auth = getAuth(app);
  storage = getStorage(app);

  // Keep the user signed in across reloads. The ID token is used exactly once,
  // to mint the httpOnly session cookie, and then forgotten.
  if (typeof window !== 'undefined') {
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error('[firebase] persistence:', error);
    });
  }
}

export { auth, storage };

/** Throws a readable error rather than returning null into calling code. */
export function requireAuth() {
  if (!auth) throw new Error(configError ?? 'Firebase auth is not initialised');
  return auth;
}

/**
 * Wait until Firebase has finished restoring the persisted session.
 *
 * `auth.currentUser` is NULL for the first few hundred milliseconds after a
 * full page load, even when the user is signed in — persistence is restored
 * asynchronously. Reading it directly on mount is a race: on a soft client
 * navigation it happens to be populated, but on a hard reload (or the redirect
 * that lands on /setup) it is not, and the code wrongly concludes the user is
 * signed out.
 *
 * Resolves with the user, or with `null` once Firebase has definitively
 * decided nobody is signed in.
 */
export function waitForUser({ timeoutMs = 10_000 } = {}) {
  const client = requireAuth();
  if (client.currentUser) return Promise.resolve(client.currentUser);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Firebase did not respond — check your connection'));
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(
      client,
      (user) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(user ?? null);
      },
      (error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      },
    );
  });
}

export default app;
