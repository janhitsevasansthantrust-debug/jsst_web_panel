'use client';

import { useEffect } from 'react';

/**
 * Registers the tiny service worker that makes the phone apps installable
 * ("Add to Home screen"). It caches nothing — every screen is live data, and
 * a stale due amount shown offline would be worse than no screen.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
