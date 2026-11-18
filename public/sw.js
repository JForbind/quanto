// Service worker retirado: la app se sirve siempre desde el servidor.
// Este archivo se autodestruye para limpiar las copias antiguas de los navegadores.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try { await self.registration.unregister(); } catch {}
    try {
      const clientes = await self.clients.matchAll({ type: 'window' });
      for (const c of clientes) { try { c.postMessage({ tipo: 'sw-retirado' }); } catch {} }
    } catch {}
  })());
});

self.addEventListener('fetch', () => {});
