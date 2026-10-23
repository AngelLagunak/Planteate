// IndexedDB mínimo: fotos guardadas en el móvil y fotos pendientes de subir.
// localStorage no sirve aquí: las fotos ocupan demasiado.
const DB = 'planteate';
let abierta = null;

function abrir() {
  abierta ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('fotos');      // fotoId → Blob
      req.result.createObjectStore('pendientes');  // fotoId → {fotoId, plantaId, base64, mime, timestamp}
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return abierta;
}

async function tx(almacen, modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(almacen, modo);
    const r = fn(t.objectStore(almacen));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const leer = (almacen, clave) => tx(almacen, 'readonly', (s) => s.get(clave));
export const guardar = (almacen, clave, valor) => tx(almacen, 'readwrite', (s) => s.put(valor, clave));
export const borrar = (almacen, clave) => tx(almacen, 'readwrite', (s) => s.delete(clave));
export const todos = (almacen) => tx(almacen, 'readonly', (s) => s.getAll());
