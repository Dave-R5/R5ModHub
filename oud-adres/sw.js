// Ruimt de oude service worker van dit adres op, zodat de doorverwijzing altijd vers geladen wordt.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
