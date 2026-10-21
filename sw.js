// PLANTEATE 5.0 — service worker: la app abre sin red.
// Sube VERSION en cada cambio para que los móviles cojan los archivos nuevos.
const VERSION = 'pl5-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/store.js', 'js/cuidados.js', 'js/aprender.js', 'js/demo.js',
  'data/especies.json', 'icons/icon.svg', 'icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'pl5-img').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La API y Wikipedia van siempre a la red (la app guarda sus propios datos).
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('script.googleusercontent.com') || url.hostname.endsWith('wikipedia.org')) return;

  // Fotos de Drive: primero caché (no cambian nunca).
  if (url.hostname === 'lh3.googleusercontent.com' || url.hostname === 'upload.wikimedia.org') {
    e.respondWith(caches.open('pl5-img').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // App y fuentes: caché al momento y actualiza por detrás.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const red = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || red;
  }));
});
