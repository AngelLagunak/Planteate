// ============================================================
// PLANTEATE 5.0 — store.js: datos locales + cola offline + sync
// ============================================================
// Local primero: todo se lee de la copia guardada en el móvil
// (localStorage, pocos KB). Cada cambio:
//   1. se mete en la cola,
//   2. se aplica al momento sobre la copia (la pantalla cambia ya),
//   3. se envía en lote a la API cuando hay red.
// La API contesta con el estado completo, que sustituye a la copia.
// Las operaciones son idempotentes: reenviar no duplica.

import { DEMO } from './demo.js';
import * as idb from './idb.js';

const K = { conf: 'pl5_conf', snap: 'pl5_snap', cola: 'pl5_cola', persona: 'pl5_persona', sync: 'pl5_sync' };

const leer = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('No se pudo guardar', k, e); } };

const estado = {
  conf: leer(K.conf, null),          // { api, k } o { demo: true }
  snap: leer(K.snap, null),          // { plantas, acciones, fotos, personas, inicioGlobal, servidor }
  cola: leer(K.cola, []),
  persona: leer(K.persona, null),
  ultimaSync: leer(K.sync, null),
  sync: 'ok',                        // ok | enviando | error | offline
  error: null
};

const oyentes = new Set();
export const suscribir = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };
const avisar = () => oyentes.forEach((fn) => fn());

// ---------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------
export const conf = () => estado.conf;
export const esDemo = () => !!estado.conf?.demo;

export function configurar(nueva) {
  estado.conf = nueva;
  guardar(K.conf, nueva);
  if (nueva?.demo) {
    estado.snap = structuredClone(DEMO);
    estado.cola = [];
    guardar(K.snap, estado.snap);
    guardar(K.cola, []);
  } else {
    estado.snap = null;
    guardar(K.snap, null);
  }
  avisar();
}

export const persona = () => estado.persona;
export function elegirPersona(nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) return;
  const existente = (vista().personas || []).find((p) => p.toLowerCase() === nombre.toLowerCase());
  estado.persona = existente || nombre;
  guardar(K.persona, estado.persona);
  if (!existente) encolar({ t: 'persona', nombre: estado.persona });
  else avisar();
}

export const infoSync = () => ({ estado: estado.sync, error: estado.error, pendientes: estado.cola.length, ultima: estado.ultimaSync });
export const tieneDatos = () => !!estado.snap;

// ---------------------------------------------------------------
// Vista = copia del servidor + cambios pendientes
// ---------------------------------------------------------------
let cacheVista = null;
export function vista() {
  if (cacheVista) return cacheVista;
  const base = estado.snap || { plantas: [], acciones: [], fotos: [], personas: [], inicioGlobal: null };
  const v = {
    ...base,
    plantas: base.plantas.map((p) => ({ ...p })),
    acciones: base.acciones.slice(),
    personas: base.personas.slice(),
    fotos: base.fotos.concat(fotosPendientes),
    especiesExtra: base.especiesExtra || []
  };
  const logIds = new Set(v.acciones.map((a) => String(a.logId)));
  for (const op of estado.cola) aplicar(v, op, logIds);
  cacheVista = v;
  return v;
}

function aplicar(v, op, logIds) {
  if (op.t === 'accion') {
    if (!logIds.has(op.logId)) { v.acciones.push({ ...op, _pendiente: true }); logIds.add(op.logId); }
  } else if (op.t === 'planta') {
    const p = v.plantas.find((x) => x.id === op.id);
    if (p) Object.assign(p, op.campos, { _pendiente: true });
    else v.plantas.push({ id: op.id, Archivada: 'FALSE', ...op.campos, _pendiente: true });
  } else if (op.t === 'anular') {
    const fuera = new Set(op.logIds);
    v.acciones = v.acciones.filter((a) => !fuera.has(String(a.logId)));
  } else if (op.t === 'persona') {
    if (!v.personas.some((n) => n.toLowerCase() === op.nombre.toLowerCase())) v.personas.push(op.nombre);
  }
}

// ---------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------
export const nuevoId = (prefijo) => `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function encolar(...ops) {
  estado.cola.push(...ops);
  guardar(K.cola, estado.cola);
  cacheVista = null;
  avisar();
  programarEnvio();
}

/** Devuelve los logIds creados (para poder deshacer). */
export function registrarAccion(plantaIds, tipoAccion, detalle = '') {
  const ts = new Date().toISOString();
  const ops = [].concat(plantaIds).map((plantaId) => ({
    t: 'accion', logId: nuevoId('log'), plantaId, tipoAccion, timestamp: ts, persona: estado.persona || '', detalle
  }));
  encolar(...ops);
  return ops.map((o) => o.logId);
}

/** Deshacer: si aún no se envió, se quita de la cola; si ya está en la hoja, se borra allí. */
export function deshacer(logIds) {
  const enCola = new Set(estado.cola.filter((op) => op.t === 'accion').map((op) => op.logId));
  const yaEnviadas = logIds.filter((id) => !enCola.has(id));
  estado.cola = estado.cola.filter((op) => !(op.t === 'accion' && logIds.includes(op.logId)));
  guardar(K.cola, estado.cola);
  cacheVista = null;
  if (yaEnviadas.length) encolar({ t: 'anular', logIds: yaEnviadas });
  else avisar();
}

export function guardarPlanta(id, campos) {
  encolar({ t: 'planta', id, campos });
}

/** Alta: crea la fila y pone en marcha los contadores (como la V4). */
export function crearPlanta(campos) {
  const base = String(campos['Nombre Casa'] || 'planta').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const id = nuevoId(base || 'planta');
  const ts = new Date().toISOString();
  encolar(
    { t: 'planta', id, campos },
    ...['riego', 'nutrir', 'trasplante'].map((tipoAccion) => ({ t: 'accion', logId: nuevoId('init'), plantaId: id, tipoAccion, timestamp: ts, persona: 'Inicio Frecuencia' }))
  );
  return id;
}

// ---------------------------------------------------------------
// Red
// ---------------------------------------------------------------
export async function api(op, args = {}, timeoutMs = 30000) {
  if (!estado.conf?.api) throw new Error('Sin conexión configurada');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(estado.conf.api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ k: estado.conf.k, op, args }),
      signal: ctrl.signal,
      redirect: 'follow'
    });
    let json;
    try { json = JSON.parse(await r.text()); }
    catch { throw new Error(`La URL no responde como la API de Planteate (HTTP ${r.status}). Revisa que acabe en /exec y que el despliegue tenga acceso "Cualquier usuario".`); }
    if (!json.ok) throw new Error(json.error === 'TOKEN' ? 'Clave de acceso incorrecta' : json.error);
    return json.data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servidor tarda demasiado');
    if (e instanceof TypeError) throw new Error('No se pudo contactar con el servidor. ¿Hay red?');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

let temporizador = null;
let enCurso = null;
function programarEnvio(ms = 400) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar(), ms);
}

/** Envía la cola (si hay) y trae el estado completo. Una sola llamada. */
export function sincronizar() {
  if (esDemo() || !estado.conf) return Promise.resolve();
  if (enCurso) return enCurso;
  if (!navigator.onLine) { estado.sync = 'offline'; avisar(); return Promise.resolve(); }

  const enviadas = estado.cola.slice();
  estado.sync = 'enviando';
  avisar();

  enCurso = api('lote', { ops: enviadas }, 45000)
    .then((data) => {
      estado.snap = data;
      estado.cola = estado.cola.slice(enviadas.length);
      estado.ultimaSync = new Date().toISOString();
      estado.sync = 'ok';
      estado.error = null;
      guardar(K.snap, data);
      guardar(K.cola, estado.cola);
      guardar(K.sync, estado.ultimaSync);
    })
    .catch((e) => {
      estado.sync = navigator.onLine ? 'error' : 'offline';
      estado.error = e.message;
      console.warn('Sync:', e);
      if (/VALIDACION/.test(e.message) && enviadas.length) {
        // Un dato inválido bloquearía la cola para siempre: se descarta ese lote.
        estado.cola = estado.cola.slice(enviadas.length);
        guardar(K.cola, estado.cola);
      } else {
        programarEnvio(estado.cola.length ? 30000 : 20000); // reintento automático
      }
    })
    .finally(() => {
      enCurso = null;
      cacheVista = null;
      avisar();
      if (estado.sync === 'ok' && estado.cola.length) programarEnvio(100);
      if (estado.sync === 'ok') subirPendientes();
    });
  return enCurso;
}

window.addEventListener('online', () => programarEnvio(100));
window.addEventListener('offline', () => { estado.sync = 'offline'; avisar(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) programarEnvio(100); });

// ---------------------------------------------------------------
// Fotos: se guardan en el móvil (IndexedDB) y se suben cuando hay red.
// En la hoja/Drive son privadas: se piden a la API una vez y se guardan.
// ---------------------------------------------------------------
const fotosPendientes = [];      // metadatos de fotos aún sin subir
const urlsFoto = new Map();      // fotoId → objectURL ya cargada

idb.todos('pendientes').then((lista) => {
  fotosPendientes.push(...lista.map(({ fotoId, plantaId, timestamp }) => ({ fotoId, plantaId, timestamp, _pendiente: true })));
  cacheVista = null; avisar();
  subirPendientes();
}).catch((e) => console.warn('IndexedDB:', e));

// Apps Script se atasca si recibe muchas peticiones a la vez: fotos de 2 en 2.
const MAX_FOTOS_A_LA_VEZ = 2;
let fotosEnCurso = 0;
const esperando = [];
async function enTurno(fn) {
  if (fotosEnCurso >= MAX_FOTOS_A_LA_VEZ) await new Promise((r) => esperando.push(r));
  fotosEnCurso++;
  try { return await fn(); }
  finally { fotosEnCurso--; esperando.shift()?.(); }
}

const aBlob = (base64, mime) => new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: mime });

/** URL lista para <img>. Fotos antiguas con url pública se usan tal cual. */
export async function urlFoto(foto) {
  if (foto.url) return foto.url;
  if (urlsFoto.has(foto.fotoId)) return urlsFoto.get(foto.fotoId);
  let blob = await idb.leer('fotos', foto.fotoId);
  if (!blob) {
    const p = await idb.leer('pendientes', foto.fotoId);
    if (p) blob = aBlob(p.base64, p.mime);
  }
  if (!blob && !esDemo()) {
    const r = await enTurno(() => api('foto', { fotoId: foto.fotoId }, 60000));
    blob = aBlob(r.base64, r.mime);
    await idb.guardar('fotos', foto.fotoId, blob);
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlsFoto.set(foto.fotoId, url);
  return url;
}

export async function subirFoto(plantaId, base64, mime) {
  const foto = { fotoId: nuevoId('foto'), plantaId, timestamp: new Date().toISOString() };
  if (esDemo()) {
    await idb.guardar('fotos', foto.fotoId, aBlob(base64, mime));
    estado.snap.fotos.push(foto);
    guardar(K.snap, estado.snap);
  } else {
    await idb.guardar('pendientes', foto.fotoId, { ...foto, base64, mime });
    fotosPendientes.push({ ...foto, _pendiente: true });
    subirPendientes();
  }
  cacheVista = null; avisar();
  return foto.fotoId;
}

let subiendo = false;
async function subirPendientes() {
  if (subiendo || esDemo() || !estado.conf?.api || !navigator.onLine) return;
  subiendo = true;
  try {
    for (const p of await idb.todos('pendientes')) {
      const r = await api('subirFoto', p, 90000);
      await idb.guardar('fotos', p.fotoId, aBlob(p.base64, p.mime));
      await idb.borrar('pendientes', p.fotoId);
      const i = fotosPendientes.findIndex((f) => f.fotoId === p.fotoId);
      if (i !== -1) fotosPendientes.splice(i, 1);
      if (!estado.snap.fotos.some((f) => f.fotoId === r.fotoId)) estado.snap.fotos.push(r);
      guardar(K.snap, estado.snap);
      cacheVista = null; avisar();
    }
  } catch (e) {
    console.warn('Subida de fotos:', e);
  } finally {
    subiendo = false;
  }
}
window.addEventListener('online', () => subirPendientes());

export const fotosSinSubir = () => fotosPendientes.length;

export async function eliminarFoto(fotoId) {
  const pendiente = fotosPendientes.findIndex((f) => f.fotoId === fotoId);
  if (pendiente !== -1) {
    fotosPendientes.splice(pendiente, 1);
    await idb.borrar('pendientes', fotoId);
  } else {
    if (!esDemo()) await api('eliminarFoto', { fotoId });
    estado.snap.fotos = estado.snap.fotos.filter((f) => f.fotoId !== fotoId);
    guardar(K.snap, estado.snap);
  }
  await idb.borrar('fotos', fotoId).catch(() => {});
  cacheVista = null; avisar();
}

// ---------------------------------------------------------------
// Pl@ntNet y Gemini: necesitan red
// ---------------------------------------------------------------
const SIN_DEMO = { ok: false, motivo: 'En modo de prueba no está disponible. Conecta tu hoja en Ajustes.' };

export async function identificar(base64, mime) {
  if (esDemo()) return SIN_DEMO;
  return api('identificar', { base64, mime }, 60000);
}

export async function diagnosticar(plantaId, base64, mime, contexto) {
  if (esDemo()) return SIN_DEMO;
  const r = await api('diagnosticar', { plantaId, base64, mime, contexto }, 90000);
  programarEnvio(100); // trae el evento de diagnóstico al historial
  return r;
}

export async function preguntar(pregunta, contexto) {
  if (esDemo()) throw new Error(SIN_DEMO.motivo);
  return (await api('preguntar', { pregunta, contexto }, 60000)).respuesta;
}

/** Crea con IA la ficha de una especie que no está en el catálogo. */
export async function fichaEspecie(nombreCientifico) {
  if (esDemo()) throw new Error(SIN_DEMO.motivo);
  const e = await api('fichaEspecie', { nombreCientifico }, 90000);
  estado.snap.especiesExtra = [...(estado.snap.especiesExtra || []).filter((x) => x.id !== e.id), e];
  guardar(K.snap, estado.snap); cacheVista = null; avisar();
  return e;
}

export const estadoAvisos = () => (esDemo() ? Promise.resolve(null) : api('avisos'));
export const probarAviso = () => api('probarAviso');

/** Copia completa en JSON (para guardar a mano). */
export function exportar() {
  return JSON.stringify({ exportado: new Date().toISOString(), ...vista() }, null, 2);
}
