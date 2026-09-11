'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which योजना the whole app is currently looking at.
 *
 * Why this exists: a trust runs several programs, and each one is a completely
 * separate book — its own members, closings, receipts and counters. The server
 * decides the scope in `requireScope()`, which takes `?programId=` if it is
 * present and otherwise falls back to the `programId` claim baked into the
 * session cookie.
 *
 * That fallback is a trap. The claim is written once, when the user is created,
 * and never changes. So the moment a second योजना exists, "add member" (which
 * posts an explicit programId chosen in the form) and "list members" (which
 * sent none, and so silently used the stale claim) end up pointing at two
 * different books — the member saves fine and the table stays empty.
 *
 * The fix is to stop relying on the claim: one active program, chosen in the
 * header, remembered in localStorage, and attached to every single request by
 * `lib/api.js`. The claim then only ever matters on the very first load, before
 * a choice has been made.
 */

const KEY = 'trust.activeProgramId';

let current = null;
const listeners = new Set();

// Read the remembered choice once, at module load, so the first render after
// hydration already has it. `useSyncExternalStore` is given a null server
// snapshot, so React reconciles this without a hydration mismatch.
if (typeof window !== 'undefined') {
  try {
    current = window.localStorage.getItem(KEY) || null;
  } catch {
    // Private mode / storage disabled — the session claim still works.
  }
}

export function getActiveProgramId() {
  return current;
}

export function setActiveProgramId(id) {
  const next = id || null;
  if (next === current) return;

  current = next;
  try {
    if (next) window.localStorage.setItem(KEY, next);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Not fatal — it just will not be remembered across reloads.
  }

  for (const fn of listeners) fn();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders the caller whenever the active योजना changes. */
export function useActiveProgramId() {
  return useSyncExternalStore(subscribe, getActiveProgramId, () => null);
}
