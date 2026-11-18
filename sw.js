// Service worker: permite instalar la app y usarla SIN INTERNET.
// Estrategia: primero intenta la red (para tener siempre la última versión);
// si no hay conexión, usa la copia guardada.
const CACHE = 'kiosco-pos-v9';
const ARCHIVOS = [
  './', 'index.html', 'styles.css?v=9', 'app.js?v=9',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((r) => {
        if (r && (r.ok || r.type === 'opaque')) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return r;
      })
      .catch(async () => {
        const c = await caches.match(req);
        if (c) return c;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      })
  );
});
