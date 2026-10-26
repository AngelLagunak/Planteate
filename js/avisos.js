// Avisos de riego con notificaciones de la propia app (sin ntfy).
// La app guarda en la caché cuándo toca regar cada planta; el service worker
// lo lee y avisa una vez al día (al abrir la app y, en Android con la app
// instalada, también en segundo plano con "periodic background sync").
const CACHE = 'pl5-avisos';
const DATOS = './avisos-datos.json';

export const soportado = () => 'Notification' in window && 'serviceWorker' in navigator;
export const permiso = () => (soportado() ? Notification.permission : 'no');

/** plantas: las de datos(); guarda solo nombre y fecha del próximo riego. */
export async function guardar(plantas) {
  if (!soportado() || Notification.permission !== 'granted') return;
  const lista = plantas.filter((p) => !p.archivada).map((p) => {
    const r = p.estado.riego;
    const cuando = r.pospuestoHasta || r.proxima || (r.sinReferencia ? new Date() : null);
    return cuando ? { nombre: p.nombre, cuando: new Date(cuando).getTime() } : null;
  }).filter(Boolean);
  try {
    const c = await caches.open(CACHE);
    await c.put(DATOS, new Response(JSON.stringify(lista), { headers: { 'Content-Type': 'application/json' } }));
    (await navigator.serviceWorker.ready).active?.postMessage({ tipo: 'comprobar-riegos' });
  } catch (e) { console.warn('Avisos:', e); }
}

/** Pide permiso y programa la comprobación diaria en segundo plano si se puede. */
export async function activar() {
  if (!soportado()) throw new Error('Este navegador no permite notificaciones.');
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error('Permiso denegado. Actívalo en los ajustes del navegador para esta web.');
  const reg = await navigator.serviceWorker.ready;
  if ('periodicSync' in reg) {
    try { await reg.periodicSync.register('planteate-riego', { minInterval: 12 * 3600 * 1000 }); } catch (e) { console.warn('periodicSync:', e); }
  }
}

export async function probar() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('🌱 Planteate', { body: 'Aviso de prueba: si lees esto, los avisos funcionan.', icon: 'icons/icon-192.png', tag: 'planteate-prueba' });
}
