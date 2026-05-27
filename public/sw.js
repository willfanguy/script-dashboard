// Minimal service worker — exists only to satisfy PWA installability.
// No caching: the dashboard is local and live data must always hit the API.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
