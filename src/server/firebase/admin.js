import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * Firebase Admin — server only.
 *
 * The old project put the service-account key behind NEXT_PUBLIC_* variables,
 * which means Next.js inlines them into the CLIENT bundle. Those are secrets:
 * they are read from server-only variables here.
 *
 * ─── Why not the `server-only` package ───────────────────────────────────
 *
 * `import 'server-only'` throws in any context that is not a React Server
 * Component — including a plain `node scripts/…` process. That would break
 * `create-owner`, `whoami` and the migration scripts, which legitimately need
 * the Admin SDK and have no React runtime at all.
 *
 * The runtime check below gives the same protection where it matters: it fires
 * if this module ever reaches a browser, while staying silent in Node.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'src/server/firebase/admin.js was imported into client code. ' +
    'This module holds the service-account key and must never reach the browser.',
  );
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function createApp() {
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  return initializeApp({
    credential: cert({
      projectId: requireEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey,
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const app = getApps()[0] ?? createApp();

export const adminAuth = getAuth(app);
export const adminStorage = getStorage(app);

export const db = getFirestore(app);

// Return `undefined` for unset fields instead of throwing, so a document that
// predates a schema addition still reads cleanly.
try {
  db.settings({ ignoreUndefinedProperties: true });
} catch {
  // settings() throws if called twice (hot reload) — the first call won.
}

export { FieldValue, Timestamp, app as adminApp };

/* ── small helpers used all over the domain layer ────────────────────────── */

export const serverNow = () => FieldValue.serverTimestamp();
export const inc = (n) => FieldValue.increment(n);
export const arrayUnion = (...v) => FieldValue.arrayUnion(...v);
export const arrayRemove = (...v) => FieldValue.arrayRemove(...v);
export const del = () => FieldValue.delete();

/**
 * Read many documents by id in one round-trip.
 * `getAll` is a single RPC, unlike the old code's `Promise.all(ids.map(get))`
 * which opened one connection per id.
 */
export async function getAllDocs(refs) {
  if (!refs.length) return [];
  const snaps = await db.getAll(...refs);
  return snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
}

/** Split an array into Firestore-safe chunks (`in` queries cap at 30). */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Count matching documents WITHOUT reading them.
 * Firestore bills an aggregation query as a handful of reads regardless of how
 * many documents match — this is how the dashboard stays at O(1).
 */
export async function countQuery(query) {
  const snap = await query.count().get();
  return snap.data().count;
}
