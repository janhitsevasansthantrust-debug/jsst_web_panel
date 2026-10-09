// Installability only. Every request goes straight to the network: these apps
// show live dues and payments, and a cached figure would be a wrong figure.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
