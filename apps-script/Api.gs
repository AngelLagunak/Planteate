// ============================================================
// PLANTEATE — Api.gs: API JSON para la PWA (V5.0)
// ============================================================
// Se AÑADE al proyecto de Apps Script de la V4 (no sustituye nada).
// La PWA (GitHub Pages) habla con este archivo por HTTP:
//
//   POST <url /exec>   cuerpo (text/plain): {"k":"<token>","op":"...","args":{...}}
//
// Se usa text/plain para que el navegador no haga "preflight" CORS, que
// Apps Script no sabe contestar.
//
// Seguridad: un token compartido guardado en Script Properties como
// API_TOKEN. Quien no lo tenga recibe {ok:false, error:'TOKEN'}.
//
// Datos: la API devuelve las hojas "en crudo" (filas como objetos) y la
// PWA calcula los estados en el móvil. Las escrituras llegan en LOTE y son
// idempotentes (se pueden repetir sin duplicar), porque la PWA guarda una
// cola offline y puede reenviar si se corta la red.
//
// Despliegue: Implementar → Nueva implementación → Aplicación web →
//   Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
// (La V4 sigue funcionando en paralelo con su propio doGet.)

const API_VERSION = '5.0';

function doPost(e) {
  let peticion;
  try {
    peticion = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return respuestaJson_({ ok: false, error: 'JSON_INVALIDO' });
  }

  const tokenEsperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!tokenEsperado || peticion.k !== tokenEsperado) {
    return respuestaJson_({ ok: false, error: 'TOKEN' });
  }

  try {
    const args = peticion.args || {};
    let resultado;
    switch (peticion.op) {
      case 'todo':          resultado = apiTodo_(); break;
      case 'lote':          resultado = apiLote_(args.ops || []); break;
      case 'subirFoto':     resultado = apiSubirFoto_(args); break;
      case 'eliminarFoto':  resultado = apiEliminarFoto_(args.fotoId); break;
      case 'identificar':   resultado = identificarPlantaPorFoto(args.base64, args.mime); break;
      case 'diagnosticar':  resultado = diagnosticarSaludPlanta(args.plantaId, args.base64, args.mime); break;
      default: return respuestaJson_({ ok: false, error: 'OP_DESCONOCIDA: ' + peticion.op });
    }
    return respuestaJson_({ ok: true, version: API_VERSION, data: resultado });
  } catch (error) {
    const mensaje = String(error && error.message || error);
    console.warn('API ' + peticion.op + ': ' + mensaje);
    return respuestaJson_({ ok: false, error: mensaje.replace(/key=[^&\s]+/gi, 'key=***') });
  }
}

function respuestaJson_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecutar UNA vez a mano: crea el token y lo muestra en el registro. */
function crearTokenApi() {
  const token = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  Logger.log('API_TOKEN = ' + token);
  return token;
}

// ---------------------------------------------------------------
// Lectura: todo de una vez
// ---------------------------------------------------------------
function apiTodo_() {
  const ss = abrirHojaDeCalculo_();
  const leer = (nombre) => {
    const hoja = ss.getSheetByName(nombre);
    return hoja ? getValoresTabla_(hoja).map(normalizarFila_) : [];
  };

  const fotos = leer('Fotos').map((fila) => {
    const urls = construirUrlsFoto_(fila);
    return { fotoId: fila.fotoId, plantaId: fila.plantaId, url: urls.url, urlGrande: urls.urlGrande, timestamp: fila.timestamp };
  });

  return {
    plantas: leer(HOJA_PLANTAS),
    acciones: leer('Acciones'),
    fotos: fotos,
    personas: getPersonas(),
    inicioGlobal: PropertiesService.getScriptProperties().getProperty('INICIO_FRECUENCIAS_GLOBAL') || null,
    servidor: new Date().toISOString()
  };
}

/** Fechas de Sheets → texto ISO, para que viajen igual en JSON. */
function normalizarFila_(fila) {
  const salida = {};
  Object.keys(fila).forEach((clave) => {
    if (!clave) return;
    const valor = fila[clave];
    salida[clave] = valor instanceof Date ? valor.toISOString() : valor;
  });
  return salida;
}

// ---------------------------------------------------------------
// Escritura: lote de operaciones idempotentes
// ---------------------------------------------------------------
// Tipos de operación (los genera la cola de la PWA):
//   {t:'accion', logId, plantaId, tipoAccion, timestamp, persona, detalle}
//   {t:'planta', id, campos}            → crea si no existe, si existe actualiza
//   {t:'persona', nombre}
// Devuelve el estado completo (apiTodo_) para que la PWA se ponga al día
// en la misma llamada.
function apiLote_(ops) {
  if (ops.length) {
    const lock = adquirirBloqueo_();
    try {
      const ss = abrirHojaDeCalculo_();
      const acciones = ops.filter((op) => op.t === 'accion');
      if (acciones.length) anadirAccionesSinDuplicar_(ss, acciones);

      ops.filter((op) => op.t === 'planta').forEach((op) => guardarPlanta_(ss, op.id, op.campos || {}));
    } finally {
      lock.releaseLock();
    }
    ops.filter((op) => op.t === 'persona').forEach((op) => registrarPersona(op.nombre));
    invalidarCacheListados_();
  }
  return apiTodo_();
}

function anadirAccionesSinDuplicar_(ss, acciones) {
  const hoja = obtenerOCrearHojaAcciones_(ss);
  asegurarColumna_(hoja, 'detalle');
  const cabeceras = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const colLog = cabeceras.indexOf('logId');

  const existentes = new Set();
  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, colLog + 1, hoja.getLastRow() - 1, 1).getValues().forEach(([v]) => existentes.add(String(v)));
  }

  const nuevas = acciones
    .filter((a) => a.logId && !existentes.has(String(a.logId)))
    .map((a) => cabeceras.map((c) => {
      if (c === 'logId') return a.logId;
      if (c === 'plantaId') return a.plantaId;
      if (c === 'tipoAccion') return a.tipoAccion;
      if (c === 'timestamp') return a.timestamp || new Date().toISOString();
      if (c === 'persona') return a.persona || '';
      if (c === 'detalle') return String(a.detalle || '').slice(0, 500);
      return '';
    }));

  if (nuevas.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, cabeceras.length).setValues(nuevas);
}

/** Crea la planta con ese id (id generado en el móvil) o actualiza sus campos. */
function guardarPlanta_(ss, id, campos) {
  const hoja = ss.getSheetByName(HOJA_PLANTAS);
  if (!hoja) throw new Error('No existe la hoja "Plantas".');

  const validacion = validarDatosPlanta_(campos, { exigirRequeridos: false });
  if (!validacion.ok) throw new Error('VALIDACION: ' + validacion.errores.join(' '));
  campos = sincronizarTextoFrecuencia_(campos);

  Object.keys(campos).forEach((nombre) => asegurarColumna_(hoja, nombre));
  const columnaOrden = nombreColumnaOrden_(hoja);
  const cabeceras = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const datos = hoja.getDataRange().getValues();
  const colId = cabeceras.indexOf('id');
  const indiceFila = datos.findIndex((fila, i) => i > 0 && fila[colId] === id);

  if (indiceFila === -1) {
    if (!campos['Nombre Casa']) throw new Error('VALIDACION: Nombre Casa es obligatorio.');
    const orden = siguienteOrdenLlegada_(ss);
    const fila = cabeceras.map((c) => {
      if (c === 'id') return id;
      if (c === columnaOrden) return orden;
      if (c === 'Archivada') return campos.Archivada || 'FALSE';
      return campos[c] !== undefined && campos[c] !== null ? campos[c] : '';
    });
    hoja.getRange(hoja.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
    return;
  }

  const actual = datos[indiceFila];
  const nueva = cabeceras.map((c, i) => Object.prototype.hasOwnProperty.call(campos, c) ? campos[c] : actual[i]);
  hoja.getRange(indiceFila + 1, 1, 1, nueva.length).setValues([nueva]);
}

// ---------------------------------------------------------------
// Fotos (solo con red)
// ---------------------------------------------------------------
function apiSubirFoto_(args) {
  const lock = adquirirBloqueo_();
  try {
    const ss = abrirHojaDeCalculo_();
    const carpeta = obtenerCarpetaPlanta_(obtenerOCrearCarpetaRaizDeFotos_(), args.plantaId);
    const hojaFotos = obtenerOCrearHojaFotos_(ss);
    asegurarColumna_(hojaFotos, 'fileId');

    const archivo = subirImagenADrive_(carpeta, args.plantaId, args.base64, args.mime);
    const urls = construirUrlsFoto_({ fileId: archivo.getId() });
    const valores = {
      fotoId: args.fotoId || generarLogId_('foto'), plantaId: args.plantaId,
      url: urls.url, urlGrande: urls.urlGrande, timestamp: new Date().toISOString(), fileId: archivo.getId()
    };
    const cabeceras = hojaFotos.getRange(1, 1, 1, hojaFotos.getLastColumn()).getValues()[0];
    hojaFotos.appendRow(cabeceras.map((c) => valores[c] !== undefined ? valores[c] : ''));
    return { fotoId: valores.fotoId, plantaId: valores.plantaId, url: urls.url, urlGrande: urls.urlGrande, timestamp: valores.timestamp };
  } finally {
    lock.releaseLock();
  }
}

function apiEliminarFoto_(fotoId) {
  eliminarFoto(fotoId);
  return { ok: true };
}
