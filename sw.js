// PLANTEATE 5.0 — service worker: la app abre sin red.
// Sube VERSION en cada cambio para que los móviles cojan los archivos nuevos.
const VERSION = 'pl5-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/store.js', 'js/cuidados.js', 'js/aprender.js', 'js/demo.js', 'js/idb.js', 'js/avisos.js',
  'data/especies.json', 'icons/icon.svg', 'icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' salta la caché HTTP de GitHub Pages (10 min): siempre los archivos nuevos.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'pl5-img' && k !== 'pl5-avisos').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La API y Wikipedia van siempre a la red (la app guarda sus propios datos).
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('script.googleusercontent.com') || url.hostname.endsWith('wikipedia.org')) return;

  // Fotos de Drive: primero caché (no cambian nunca).
  if (url.hostname === 'lh3.googleusercontent.com' || url.hostname.endsWith('.wikimedia.org')) {
    e.respondWith(caches.open('pl5-img').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // La página: primero red (para ver cambios ya), caché si no hay red.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }

  // App y fuentes: caché al momento y actualiza por detrás.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const red = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || red;
  }));
});

// ---------------------------------------------------------------
// Avisos de riego (los datos los escribe js/avisos.js)
// ---------------------------------------------------------------
async function comprobarRiegos() {
  const c = await caches.open('pl5-avisos');
  const r = await c.match('./avisos-datos.json');
  if (!r) return;
  const ahora = new Date();
  if (ahora.getHours() < 9) return; // no despertar a nadie
  const hoy = ahora.toISOString().slice(0, 10);
  const ultimo = await c.match('./avisos-ultimo');
  if (ultimo && (await ultimo.text()) === hoy) return; // ya avisado hoy
  const finDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1).getTime();
  const toca = (await r.json()).filter((p) => p.cuando < finDeHoy);
  if (!toca.length) return;
  await self.registration.showNotification('💧 Hoy toca regar ' + toca.length + (toca.length === 1 ? ' planta' : ' plantas'), {
    body: toca.map((p) => p.nombre).join(', '), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'planteate-riego'
  });
  await c.put('./avisos-ultimo', new Response(hoy));
}

self.addEventListener('message', (e) => { if (e.data?.tipo === 'comprobar-riegos') e.waitUntil(comprobarRiegos()); });
self.addEventListener('periodicsync', (e) => { if (e.tag === 'planteate-riego') e.waitUntil(comprobarRiegos()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((ws) => (ws[0] ? ws[0].focus() : self.clients.openWindow('./#/'))));
});
