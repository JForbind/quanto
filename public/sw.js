// Service worker de Quanto: red primero para la app, datos siempre frescos.
const CACHE = 'quanto-v7';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/echarts.min.js', '/manifest.webmanifest', '/favicon.png', '/fonts/NDLogos.ttf'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;
  const isDocument = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => {
        if (r) return r;
        // Solo se sirve el HTML como respaldo de una página; nunca para un .js/.css
        if (isDocument) return caches.match('/index.html');
        return Response.error();
      }))
  );
});
