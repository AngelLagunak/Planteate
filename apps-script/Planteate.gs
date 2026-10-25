// ============================================================
// PLANTEATE — Planteate.gs: backend completo de la PWA (V5.1.1)
// ============================================================
// UN solo archivo. Sustituye a TODOS los .gs y .html de la V4 (y al
// Api.gs de la 5.0): bórralos del proyecto y deja solo este.
//
// La PWA habla con este archivo por HTTP:
//   POST <url /exec>  cuerpo (text/plain): {"k":"<token>","op":"...","args":{...}}
// (text/plain evita el "preflight" CORS, que Apps Script no contesta).
//
// Script Properties:
//   API_TOKEN          obligatorio (crearlo con crearTokenApi)
//   SPREADSHEET_ID     la hoja de datos (ya existe de la V4)
//   FOLDER_ID          carpeta de fotos en Drive (ya existe de la V4)
//   PLANTNET_API_KEY   identificar y diagnosticar por foto
//   GEMINI_API_KEY     opcional: fichas nuevas, preguntas, consejos
//   GEMINI_MODEL       opcional, por defecto gemini-2.5-flash
//   APP_URL            URL de la PWA (para leer el catálogo de especies en el aviso diario)
//   Avisos al móvil (cualquiera de estos, o varios):
//     NTFY_TOPIC                         app ntfy (gratis, sin cuenta)
//     TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   bot de Telegram
//     CALLMEBOT_PHONE + CALLMEBOT_APIKEY      WhatsApp vía CallMeBot (servicio no oficial)
//
// Funciones para ejecutar a mano desde el editor (desplegable → ▶):
//   crearTokenApi · activarAvisoDiario · enviarAvisoDiario · hacerFotosPrivadas

const VERSION_API = '5.1.1';
const HOJAS = { plantas: 'Plantas', acciones: 'Acciones', fotos: 'Fotos', personas: 'Personas', especies: 'Especies' };
const ZONA = 'Europe/Madrid';

// ---------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------
function doGet() {
  return json_({ ok: true, app: 'Planteate', version: VERSION_API, info: 'Usa POST desde la app.' });
}

function doPost(e) {
  let p;
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (error) { return json_({ ok: false, error: 'JSON_INVALIDO' }); }

  const token = prop_('API_TOKEN');
  if (!token || p.k !== token) return json_({ ok: false, error: 'TOKEN' });

  try {
    const a = p.args || {};
    const ops = {
      todo: () => todo_(),
      lote: () => lote_(a.ops || []),
      subirFoto: () => subirFoto_(a),
      foto: () => leerFoto_(a.fotoId),
      eliminarFoto: () => eliminarFoto_(a.fotoId),
      identificar: () => identificar_(a.base64, a.mime),
      diagnosticar: () => diagnosticar_(a),
      preguntar: () => preguntar_(a),
      fichaEspecie: () => fichaEspecie_(a.nombreCientifico),
      avisos: () => estadoAvisos_(),
      probarAviso: () => probarAviso_()
    };
    if (!ops[p.op]) return json_({ ok: false, error: 'OP_DESCONOCIDA: ' + p.op });
    return json_({ ok: true, version: VERSION_API, data: ops[p.op]() });
  } catch (error) {
    const msg = String((error && error.message) || error).replace(/(key|token)=[^&\s]+/gi, '$1=***');
    console.warn('API ' + p.op + ': ' + msg);
    return json_({ ok: false, error: msg });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function prop_(clave) { return PropertiesService.getScriptProperties().getProperty(clave); }

/** Ejecutar a mano para ver si Gemini responde (y el motivo si no). */
function probarGemini() {
  const r = gemini_('Responde solo: "Gemini funciona".');
  Logger.log(r === null ? 'Falta GEMINI_API_KEY' : r);
  return r;
}

function crearTokenApi() {
  const token = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  Logger.log('API_TOKEN = ' + token);
  return token;
}

// ---------------------------------------------------------------
// Hoja de cálculo
// ---------------------------------------------------------------
function ss_() {
  const id = prop_('SPREADSHEET_ID');
  if (!id) throw new Error('Falta SPREADSHEET_ID en Script Properties.');
  return SpreadsheetApp.openById(id);
}

function hoja_(ss, nombre, cabeceras) {
  let h = ss.getSheetByName(nombre);
  if (!h) { h = ss.insertSheet(nombre); h.appendRow(cabeceras); }
  else if (h.getLastRow() === 0) h.appendRow(cabeceras);
  return h;
}

const CABECERAS = {
  Plantas: ['id', 'Orden de llegada', 'Nombre Casa', 'Nombre científico', 'Archivada'],
  Acciones: ['logId', 'plantaId', 'tipoAccion', 'timestamp', 'persona', 'detalle'],
  Fotos: ['fotoId', 'plantaId', 'url', 'urlGrande', 'timestamp', 'fileId'],
  Personas: ['nombre', 'fechaAlta'],
  Especies: ['id', 'json', 'fecha']
};

function bloqueo_() { const l = LockService.getScriptLock(); l.waitLock(15000); return l; }

/** Hoja → array de objetos. Fechas a ISO. Filas vacías fuera. */
function tabla_(h) {
  if (!h) return [];
  const filas = h.getDataRange().getValues();
  if (filas.length < 2) return [];
  const cab = filas[0];
  const out = [];
  for (let i = 1; i < filas.length; i++) {
    const o = {}; let hay = false;
    cab.forEach((c, j) => {
      if (!c) return;
      let v = filas[i][j];
      if (v instanceof Date) v = v.toISOString();
      o[c] = v;
      if (v !== '' && v !== null) hay = true;
    });
    if (hay) out.push(o);
  }
  return out;
}

function columna_(h, nombre) {
  const cab = h.getRange(1, 1, 1, Math.max(h.getLastColumn(), 1)).getValues()[0];
  let i = cab.indexOf(nombre);
  if (i === -1) { i = cab.filter(String).length; h.getRange(1, i + 1).setValue(nombre); }
  return i;
}

function cabeceras_(h) { return h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0]; }

// ---------------------------------------------------------------
// Lectura completa
// ---------------------------------------------------------------
function todo_() {
  const ss = ss_();
  const personas = {};
  tabla_(ss.getSheetByName(HOJAS.personas)).forEach((f) => {
    const n = String(f.nombre || '').trim();
    if (n && !personas[n.toLowerCase()]) personas[n.toLowerCase()] = n;
  });
  return {
    plantas: tabla_(ss.getSheetByName(HOJAS.plantas)),
    acciones: tabla_(ss.getSheetByName(HOJAS.acciones)),
    fotos: tabla_(ss.getSheetByName(HOJAS.fotos)).map((f) => ({ fotoId: f.fotoId, plantaId: f.plantaId, timestamp: f.timestamp })),
    personas: Object.keys(personas).map((k) => personas[k]).sort((a, b) => a.localeCompare(b)),
    especiesExtra: especiesExtra_(ss),
    inicioGlobal: prop_('INICIO_FRECUENCIAS_GLOBAL') || null,
    servidor: new Date().toISOString()
  };
}

function especiesExtra_(ss) {
  return tabla_(ss.getSheetByName(HOJAS.especies)).map((f) => { try { return JSON.parse(f.json); } catch (e) { return null; } }).filter(Boolean);
}

// ---------------------------------------------------------------
// Escritura en lote (idempotente)
// ---------------------------------------------------------------
//   {t:'accion', logId, plantaId, tipoAccion, timestamp, persona, detalle}
//   {t:'anular', logIds:[...]}      borra esas acciones (Deshacer)
//   {t:'planta', id, campos}         crea o actualiza
//   {t:'persona', nombre}
function lote_(ops) {
  if (ops.length) {
    const l = bloqueo_();
    try {
      const ss = ss_();
      const acciones = ops.filter((o) => o.t === 'accion');
      if (acciones.length) anadirAcciones_(ss, acciones);
      const anular = [].concat.apply([], ops.filter((o) => o.t === 'anular').map((o) => o.logIds || []));
      if (anular.length) anularAcciones_(ss, anular);
      ops.filter((o) => o.t === 'planta').forEach((o) => guardarPlanta_(ss, o.id, o.campos || {}));
      ops.filter((o) => o.t === 'persona').forEach((o) => registrarPersona_(ss, o.nombre));
    } finally { l.releaseLock(); }
  }
  return todo_();
}

function anadirAcciones_(ss, acciones) {
  const h = hoja_(ss, HOJAS.acciones, CABECERAS.Acciones);
  columna_(h, 'detalle');
  const cab = cabeceras_(h);
  const iLog = cab.indexOf('logId');
  const existen = new Set();
  if (h.getLastRow() > 1) h.getRange(2, iLog + 1, h.getLastRow() - 1, 1).getValues().forEach((r) => existen.add(String(r[0])));
  const filas = acciones.filter((a) => a.logId && !existen.has(String(a.logId))).map((a) => cab.map((c) => {
    if (c === 'detalle') return String(a.detalle || '').slice(0, 500);
    if (c === 'timestamp') return a.timestamp || new Date().toISOString();
    return a[c] !== undefined && a[c] !== null ? a[c] : '';
  }));
  if (filas.length) h.getRange(h.getLastRow() + 1, 1, filas.length, cab.length).setValues(filas);
}

function anularAcciones_(ss, logIds) {
  const h = ss.getSheetByName(HOJAS.acciones);
  if (!h || h.getLastRow() < 2) return;
  const quitar = new Set(logIds.map(String));
  const iLog = cabeceras_(h).indexOf('logId');
  const valores = h.getRange(2, iLog + 1, h.getLastRow() - 1, 1).getValues();
  for (let i = valores.length - 1; i >= 0; i--) if (quitar.has(String(valores[i][0]))) h.deleteRow(i + 2);
}

function registrarPersona_(ss, nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) return;
  const h = hoja_(ss, HOJAS.personas, CABECERAS.Personas);
  const ya = tabla_(h).some((f) => String(f.nombre || '').trim().toLowerCase() === nombre.toLowerCase());
  if (!ya) h.appendRow([nombre, new Date().toISOString()]);
}

// --- Plantas -----------------------------------------------------
const FRECUENCIAS = [
  ['Riego - intervalo mín (prim/verano)', 'Riego - intervalo máx (prim/verano)', 'Riego - unidad (prim/verano)', 'Riego - primavera/verano', 'Riego prim/verano'],
  ['Riego - intervalo mín (oto/invierno)', 'Riego - intervalo máx (oto/invierno)', 'Riego - unidad (oto/invierno)', 'Riego - otoño/invierno', 'Riego oto/invierno'],
  ['Abono - intervalo mín', 'Abono - intervalo máx', 'Abono - unidad', 'Frecuencia abono', 'Nutrir'],
  ['Fertilizante - intervalo mín', 'Fertilizante - intervalo máx', 'Fertilizante - unidad', 'Frecuencia fertilizante', 'Fertilizante'],
  ['Trasplante - intervalo mín', 'Trasplante - intervalo máx', 'Trasplante - unidad', 'Trasplante', 'Trasplante']
];
const UNIDADES = { dia: ['día', 'días'], semana: ['semana', 'semanas'], mes: ['mes', 'meses'], 'año': ['año', 'años'] };

function validarPlanta_(c) {
  const errores = [];
  if ('Nombre Casa' in c && !String(c['Nombre Casa'] || '').trim()) errores.push('Nombre Casa es obligatorio.');
  if (String(c['Nombre Casa'] || '').length > 100) errores.push('Nombre Casa: máximo 100 caracteres.');
  FRECUENCIAS.forEach(([cMin, cMax, cUni, , etq]) => {
    [cMin, cMax].forEach((k) => {
      if (k in c && c[k] !== '' && !(Number(c[k]) >= 0 && Number(c[k]) <= 3650)) errores.push(etq + ': número no válido.');
    });
    if (cUni in c && c[cUni] && !UNIDADES[c[cUni]]) errores.push(etq + ': unidad no válida.');
    if (Number(c[cMin]) > 0 && Number(c[cMax]) > 0 && Number(c[cMin]) > Number(c[cMax])) errores.push(etq + ': el mínimo supera al máximo.');
  });
  if (errores.length) throw new Error('VALIDACION: ' + errores.join(' '));
}

/** Mantiene la columna de texto legado ("cada 7 días") por compatibilidad. */
function textoLegado_(c) {
  FRECUENCIAS.forEach(([cMin, cMax, cUni, cTxt]) => {
    if (!(cMin in c) && !(cMax in c) && !(cUni in c)) return;
    const par = UNIDADES[c[cUni]];
    const a = Number(c[cMin]) || 0, b = Number(c[cMax]) || 0;
    if (!par || (!a && !b)) return;
    c[cTxt] = a && b && a !== b ? 'cada ' + Math.min(a, b) + '-' + Math.max(a, b) + ' ' + par[1] : 'cada ' + (a || b) + ' ' + ((a || b) === 1 ? par[0] : par[1]);
  });
  return c;
}

function guardarPlanta_(ss, id, campos) {
  validarPlanta_(campos);
  campos = textoLegado_(campos);
  const h = hoja_(ss, HOJAS.plantas, CABECERAS.Plantas);
  Object.keys(campos).forEach((k) => columna_(h, k));
  const cab = cabeceras_(h);
  const colOrden = cab.indexOf('Orden de llegada') !== -1 ? 'Orden de llegada' : (cab.indexOf('Número') !== -1 ? 'Número' : null);
  const datos = h.getDataRange().getValues();
  const iId = cab.indexOf('id');
  const fila = datos.findIndex((r, i) => i > 0 && r[iId] === id);

  if (fila === -1) {
    if (!String(campos['Nombre Casa'] || '').trim()) throw new Error('VALIDACION: Nombre Casa es obligatorio.');
    let orden = 1;
    if (colOrden) { const j = cab.indexOf(colOrden); datos.slice(1).forEach((r) => { if (Number(r[j]) >= orden) orden = Number(r[j]) + 1; }); }
    const nueva = cab.map((c) => c === 'id' ? id : c === colOrden ? orden : c === 'Archivada' ? (campos.Archivada || 'FALSE') : (campos[c] !== undefined && campos[c] !== null ? campos[c] : ''));
    h.getRange(h.getLastRow() + 1, 1, 1, nueva.length).setValues([nueva]);
    return;
  }
  const actual = datos[fila];
  h.getRange(fila + 1, 1, 1, cab.length).setValues([cab.map((c, i) => Object.prototype.hasOwnProperty.call(campos, c) ? campos[c] : (actual[i] === undefined ? '' : actual[i]))]);
}

// ---------------------------------------------------------------
// Fotos (privadas: solo se ven a través de la API)
// ---------------------------------------------------------------
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

function carpetaRaiz_() {
  const id = prop_('FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const c = DriveApp.createFolder('Planteate - Fotos');
  PropertiesService.getScriptProperties().setProperty('FOLDER_ID', c.getId());
  return c;
}

function carpetaPlanta_(plantaId) {
  const raiz = carpetaRaiz_();
  const it = raiz.getFoldersByName(plantaId);
  return it.hasNext() ? it.next() : raiz.createFolder(plantaId);
}

function subirFoto_(a) {
  if (TIPOS_FOTO.indexOf(a.mime || 'image/jpeg') === -1) throw new Error('Formato de foto no permitido.');
  const bytes = Utilities.base64Decode(a.base64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Foto demasiado grande.');
  const l = bloqueo_();
  try {
    const ss = ss_();
    const h = hoja_(ss, HOJAS.fotos, CABECERAS.Fotos);
    columna_(h, 'fileId');
    const fotoId = a.fotoId || ('foto_' + Date.now());
    const ya = tabla_(h).filter((f) => f.fotoId === fotoId)[0];
    if (ya) return { fotoId: fotoId, plantaId: ya.plantaId, timestamp: ya.timestamp };

    const archivo = carpetaPlanta_(a.plantaId).createFile(Utilities.newBlob(bytes, a.mime || 'image/jpeg', a.plantaId + '_' + Date.now() + '.jpg'));
    const ts = a.timestamp || new Date().toISOString();
    const valores = { fotoId: fotoId, plantaId: a.plantaId, timestamp: ts, fileId: archivo.getId() };
    h.appendRow(cabeceras_(h).map((c) => valores[c] !== undefined ? valores[c] : ''));
    return { fotoId: fotoId, plantaId: a.plantaId, timestamp: ts };
  } finally { l.releaseLock(); }
}

function filaFoto_(fotoId) {
  const h = ss_().getSheetByName(HOJAS.fotos);
  return tabla_(h).filter((f) => f.fotoId === fotoId)[0] || null;
}

function fileIdDe_(f) {
  if (f.fileId) return f.fileId;
  const m = String(f.url || f.urlGrande || '').match(/[?&]id=([^&]+)|\/d\/([^=/?]+)/);
  return m ? (m[1] || m[2]) : null;
}

/** Devuelve la foto en base64 (la app la guarda en el móvil y no la vuelve a pedir). */
function leerFoto_(fotoId) {
  const f = filaFoto_(fotoId);
  if (!f) throw new Error('Foto no encontrada.');
  const blob = DriveApp.getFileById(fileIdDe_(f)).getBlob();
  return { fotoId: fotoId, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function eliminarFoto_(fotoId) {
  const l = bloqueo_();
  try {
    const h = ss_().getSheetByName(HOJAS.fotos);
    if (!h) return { ok: true };
    const datos = h.getDataRange().getValues();
    const cab = datos[0];
    const i = datos.findIndex((r, j) => j > 0 && r[cab.indexOf('fotoId')] === fotoId);
    if (i === -1) return { ok: true };
    const obj = {}; cab.forEach((c, j) => { obj[c] = datos[i][j]; });
    h.deleteRow(i + 1);
    try { DriveApp.getFileById(fileIdDe_(obj)).setTrashed(true); } catch (e) { console.warn('Papelera: ' + e); }
    return { ok: true };
  } finally { l.releaseLock(); }
}

/** Ejecutar UNA vez: quita el "cualquiera con el enlace" de la carpeta y de todas las fotos. */
function hacerFotosPrivadas() {
  const raiz = carpetaRaiz_();
  let n = 0;
  const recorrer = (carpeta) => {
    carpeta.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    const archivos = carpeta.getFiles();
    while (archivos.hasNext()) { archivos.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); n++; }
    const sub = carpeta.getFolders();
    while (sub.hasNext()) recorrer(sub.next());
  };
  recorrer(raiz);
  Logger.log('Fotos privadas: ' + n);
  return n;
}

// ---------------------------------------------------------------
// Pl@ntNet: identificar y diagnosticar
// ---------------------------------------------------------------
function plantnet_(ruta, base64, mime, extra) {
  const key = prop_('PLANTNET_API_KEY');
  if (!key) throw new Error('Falta PLANTNET_API_KEY en Script Properties.');
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', 'foto.jpg');
  const payload = Object.assign({ images: blob }, extra || {});
  const r = UrlFetchApp.fetch('https://my-api.plantnet.org/v2/' + ruta + '?lang=es&api-key=' + encodeURIComponent(key), { method: 'post', payload: payload, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return { results: [] };
  if (r.getResponseCode() >= 300) throw new Error('Pl@ntNet respondió ' + r.getResponseCode());
  return JSON.parse(r.getContentText());
}

function identificar_(base64, mime) {
  try {
    const d = plantnet_('identify/all', base64, mime, { organs: 'auto' });
    const candidatos = (d.results || []).slice(0, 5).map((r) => ({
      nombreCientifico: r.species && r.species.scientificNameWithoutAuthor,
      nombreComunSugerido: r.species && r.species.commonNames && r.species.commonNames[0],
      familia: r.species && r.species.family && r.species.family.scientificNameWithoutAuthor,
      confianza: r.score
    })).filter((c) => c.nombreCientifico);
    return candidatos.length ? { ok: true, candidatos: candidatos } : { ok: false, motivo: 'No se reconoce ninguna especie con confianza. Prueba otra foto o escríbela a mano.' };
  } catch (e) {
    return { ok: false, motivo: String(e.message || e) };
  }
}

/** contexto lo calcula la app: {nombrePlanta, especie, estacion, riego:{nivel,diasDesde,freqDias,sinReferencia}} */
function diagnosticar_(a) {
  try {
    const d = plantnet_('diseases/identify', a.base64, a.mime);
    const problemas = (d.results || []).filter((r) => r.score >= 0.15).slice(0, 3).map((r) => ({ nombre: r.description || r.name, probabilidad: r.score }));
    const ctx = a.contexto || {};
    const riego = ctx.riego || {};
    const lineas = [];
    if (riego.sinReferencia) lineas.push('⚠️ Sin fecha de referencia de riego: no se puede saber si el agua es la causa.');
    else if (riego.nivel === 'rojo' && !problemas.length) lineas.push('💧 El riego va ' + riego.diasDesde + ' días después del último (toca cada ' + Math.round(riego.freqDias) + ' aprox.) y la foto no muestra enfermedad. Lo más probable es sed: riega y mira si se recupera en 24–48 h.');
    else if (riego.nivel === 'verde' && riego.diasDesde <= 1 && problemas.length) lineas.push('💧 El riego está al día: probablemente no es falta de agua. Si la tierra está muy húmeda, sospecha de exceso.');
    else if (riego.nivel && riego.nivel !== 'verde') lineas.push('💧 El riego va algo retrasado; puede influir, pero no lo explica todo.');
    if (ctx.estacion) lineas.push('🗓️ ' + ctx.estacion + ': en la época fría es normal que crezca menos.');
    if (problemas.length) {
      lineas.push('🔍 Posibles causas en la foto:');
      problemas.forEach((p) => lineas.push('   • ' + p.nombre + ' (' + Math.round(p.probabilidad * 100) + '%)'));
    } else lineas.push('🔍 La foto no muestra plagas ni enfermedades conocidas.');

    const consejo = geminiOpcional_('Eres un experto en plantas de interior. Explica en español, cercano y práctico, en 3–5 frases, este diagnóstico ya calculado (no inventes hechos ni recomiendes productos químicos concretos). Planta: ' +
      (ctx.nombrePlanta || '') + ' (' + (ctx.especie || 'especie desconocida') + ').\n' + lineas.join('\n'));
    if (consejo) lineas.push('', '🤖 ' + consejo);

    registrarEvento_(a.plantaId, 'diagnostico', problemas.length ? problemas.map((p) => p.nombre).join(', ') : 'sin signos de enfermedad');
    return { ok: true, diagnostico: { resumen: lineas } };
  } catch (e) {
    return { ok: false, motivo: String(e.message || e) };
  }
}

function registrarEvento_(plantaId, tipo, detalle) {
  try {
    anadirAcciones_(ss_(), [{ logId: 'evt_' + Date.now(), plantaId: plantaId, tipoAccion: tipo, timestamp: new Date().toISOString(), persona: '', detalle: detalle }]);
  } catch (e) { console.warn('evento: ' + e); }
}

// ---------------------------------------------------------------
// Gemini (opcional, capa gratuita)
// ---------------------------------------------------------------
/**
 * Llama a Gemini. Sin clave devuelve null. Si falla, lanza un error con el
 * motivo real (para verlo en la app). Si el modelo ya no existe (404), prueba
 * el siguiente de la lista: Google retira modelos con el tiempo.
 */
function gemini_(prompt, comoJson) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) return null;
  const modelos = [prop_('GEMINI_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);
  const cuerpo = { contents: [{ parts: [{ text: prompt }] }] };
  if (comoJson) cuerpo.generationConfig = { responseMimeType: 'application/json' };

  let error = null;
  for (const modelo of modelos) {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(cuerpo), muteHttpExceptions: true
    });
    const codigo = r.getResponseCode();
    if (codigo < 300) {
      const d = JSON.parse(r.getContentText());
      const t = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts[0].text;
      if (t) return t.trim();
      error = 'Gemini (' + modelo + ') no devolvió texto.';
      continue;
    }
    let detalle = '';
    try { detalle = JSON.parse(r.getContentText()).error.message; } catch (e) { detalle = r.getContentText().slice(0, 200); }
    error = 'Gemini ' + codigo + ' (' + modelo + '): ' + detalle;
    console.warn(error);
    if (codigo !== 404) break; // 400/403 = clave mal, 429 = cupo: probar otro modelo no ayuda
  }
  throw new Error(error);
}

/** Igual que gemini_ pero sin romper: para extras opcionales (consejo del diagnóstico). */
function geminiOpcional_(prompt) {
  try { return gemini_(prompt); } catch (e) { return null; }
}

function exigirGemini_() {
  if (!prop_('GEMINI_API_KEY')) throw new Error('Falta GEMINI_API_KEY en Script Properties (gratis en aistudio.google.com/apikey).');
}

/** Pregunta libre sobre una planta, con su contexto. */
function preguntar_(a) {
  exigirGemini_();
  const r = gemini_('Eres un experto en plantas de interior que ayuda a una familia en España a cuidar y aprender sobre sus plantas. ' +
    'Responde en español, claro y breve (máximo 6 frases), explicando el porqué. Si no estás seguro, dilo. No recomiendes productos químicos concretos.\n\n' +
    'Contexto de la planta:\n' + JSON.stringify(a.contexto || {}) + '\n\nPregunta: ' + String(a.pregunta || '').slice(0, 500));
  if (!r) throw new Error('Gemini no respondió. Prueba en un rato.');
  return { respuesta: r };
}

/** Crea la ficha de una especie que no está en el catálogo y la guarda en la hoja "Especies". */
function fichaEspecie_(nombreCientifico) {
  exigirGemini_();
  nombreCientifico = String(nombreCientifico || '').trim();
  if (!nombreCientifico) throw new Error('Falta el nombre científico.');
  const ejemplo = '{"id":"slug-sin-tildes","cientifico":"","familia":"","genero":"","nombres":["nombre común en España"],"wiki":"título exacto del artículo en es.wikipedia","riego":{"cv":{"min":7,"max":10,"unidad":"dia"},"oi":{"min":14,"max":21,"unidad":"dia"},"cantidad":"","metodo":"","comoSaber":""},"nutrir":{"min":1,"max":1,"unidad":"mes","tipo":"","cuando":""},"trasplante":{"min":1,"max":2,"unidad":"año","nota":""},"luz":{"tipo":"","exposicion":"","horas":""},"sustrato":"","temperatura":"","toxica":true,"toxicidad":"","origen":"","porQue":"","errores":["",""],"pistas":["",""],"curiosidad":""}';
  const texto = gemini_('Crea la ficha de cuidados de interior de la especie "' + nombreCientifico + '" para una app doméstica en España. ' +
    'Devuelve SOLO JSON con exactamente esta forma (unidad: dia|semana|mes|año; cv = primavera-verano, oi = otoño-invierno; textos en español, frases cortas y sencillas; "porQue" explica su hábitat natural y por qué se cuida así; "comoSaber" cómo saber si necesita agua). Datos prudentes y realistas:\n' + ejemplo, true);
  if (!texto) throw new Error('Gemini no respondió. Prueba en un rato.');
  const e = JSON.parse(texto.replace(/^```json|```$/g, ''));
  e.id = String(e.id || nombreCientifico).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  e.generadaConIA = true;
  const l = bloqueo_();
  try {
    const h = hoja_(ss_(), HOJAS.especies, CABECERAS.Especies);
    const filas = tabla_(h);
    const i = filas.findIndex((f) => f.id === e.id);
    if (i === -1) h.appendRow([e.id, JSON.stringify(e), new Date().toISOString()]);
    else h.getRange(i + 2, 2).setValue(JSON.stringify(e));
  } finally { l.releaseLock(); }
  return e;
}

// ---------------------------------------------------------------
// Aviso diario al móvil
// ---------------------------------------------------------------
function estadoAvisos_() {
  const canales = [];
  if (prop_('NTFY_TOPIC')) canales.push('ntfy');
  if (prop_('TELEGRAM_BOT_TOKEN') && prop_('TELEGRAM_CHAT_ID')) canales.push('Telegram');
  if (prop_('CALLMEBOT_PHONE') && prop_('CALLMEBOT_APIKEY')) canales.push('WhatsApp');
  const activo = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'enviarAvisoDiario');
  return { canales: canales, programado: activo, ntfyTopic: prop_('NTFY_TOPIC') || null, gemini: !!prop_('GEMINI_API_KEY') };
}

function probarAviso_() {
  const enviados = enviar_('🌱 Planteate', 'Aviso de prueba: si lees esto, los avisos funcionan.');
  if (!enviados) throw new Error('No hay ningún canal configurado (NTFY_TOPIC, Telegram o CallMeBot).');
  return { enviados: enviados };
}

/** Ejecutar UNA vez: programa el aviso cada día a las 9:00. */
function activarAvisoDiario() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'enviarAvisoDiario').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarAvisoDiario').timeBased().everyDays(1).atHour(9).inTimezone(ZONA).create();
  return 'Aviso diario programado a las 9:00.';
}

function enviarAvisoDiario() {
  const lista = plantasQueTocaRegar_();
  if (!lista.length) return 'Nada que regar hoy.';
  const lineas = lista.map((p) => '💧 ' + p.nombre + (p.atraso > 0 ? ' (lleva ' + p.atraso + ' d de retraso)' : ''));
  const url = prop_('APP_URL');
  enviar_('🌱 Hoy toca regar ' + lista.length + (lista.length === 1 ? ' planta' : ' plantas'), lineas.join('\n') + (url ? '\n\nAbrir: ' + url : ''), url);
  return lineas.join('\n');
}

function enviar_(titulo, texto, url) {
  let n = 0;
  const intentar = (nombre, fn) => { try { fn(); n++; } catch (e) { console.warn('Aviso ' + nombre + ': ' + e); } };
  const topic = prop_('NTFY_TOPIC');
  if (topic) intentar('ntfy', () => UrlFetchApp.fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
    method: 'post', payload: Utilities.newBlob(texto).getBytes(),
    // Título con tildes/emoji: codificado RFC 2047, que ntfy entiende.
    headers: Object.assign({ Title: '=?UTF-8?B?' + Utilities.base64Encode(titulo, Utilities.Charset.UTF_8) + '?=', Tags: 'seedling' }, url ? { Click: url } : {})
  }));
  const tg = prop_('TELEGRAM_BOT_TOKEN'), chat = prop_('TELEGRAM_CHAT_ID');
  if (tg && chat) intentar('Telegram', () => UrlFetchApp.fetch('https://api.telegram.org/bot' + tg + '/sendMessage', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ chat_id: chat, text: titulo + '\n\n' + texto })
  }));
  const tel = prop_('CALLMEBOT_PHONE'), cmb = prop_('CALLMEBOT_APIKEY');
  if (tel && cmb) intentar('WhatsApp', () => UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(tel) + '&apikey=' + encodeURIComponent(cmb) + '&text=' + encodeURIComponent(titulo + '\n' + texto)));
  return n;
}

// --- Reglas de riego (las mismas que js/cuidados.js) -------------
function plantasQueTocaRegar_() {
  const ss = ss_();
  const plantas = tabla_(ss.getSheetByName(HOJAS.plantas)).filter((p) => p.id && String(p.Archivada).toUpperCase() !== 'TRUE');
  const acciones = tabla_(ss.getSheetByName(HOJAS.acciones)).filter((a) => a.tipoAccion === 'riego');
  const especies = catalogo_(ss);
  const inicio = prop_('INICIO_FRECUENCIAS_GLOBAL');
  const hoy = new Date();
  const calida = esCalida_(hoy);

  const ultimo = {};
  acciones.forEach((a) => { const f = new Date(a.timestamp); if (!ultimo[a.plantaId] || f > ultimo[a.plantaId]) ultimo[a.plantaId] = f; });

  return plantas.map((p) => {
    const ref = ultimo[p.id] || (inicio ? new Date(inicio) : null);
    const pospuesto = p.RiegoPospuestoHasta ? new Date(p.RiegoPospuestoHasta) : null;
    if (pospuesto && hoy < pospuesto) return null;
    const freq = frecuenciaRiego_(p, especieDe_(p, especies), calida);
    if (!ref) return { nombre: p['Nombre Casa'], atraso: 0 };
    const restantes = Math.ceil(freq - diasEntre_(ref, hoy));
    return restantes <= 0 ? { nombre: p['Nombre Casa'], atraso: -restantes } : null;
  }).filter(Boolean).sort((a, b) => b.atraso - a.atraso);
}

function catalogo_(ss) {
  let base = [];
  const url = prop_('APP_URL');
  if (url) {
    try { base = JSON.parse(UrlFetchApp.fetch(url.replace(/\/?$/, '/') + 'data/especies.json').getContentText()).especies || []; }
    catch (e) { console.warn('Catálogo: ' + e); }
  }
  return base.concat(especiesExtra_(ss));
}

function especieDe_(p, especies) {
  if (p.especieId) { const e = especies.filter((x) => x.id === p.especieId)[0]; if (e) return e; }
  const n = String(p['Nombre científico'] || '').trim().toLowerCase();
  if (!n) return null;
  const genero = n.split(/\s+/)[0];
  const sinonimo = (x) => (x.sinonimos || []).some((s) => { s = String(s).toLowerCase(); return s === n || s.split(/\s+/)[0] === genero; });
  return especies.filter((x) => String(x.cientifico).toLowerCase() === n)[0] || especies.filter((x) => String(x.genero).toLowerCase() === genero)[0] || especies.filter(sinonimo)[0] || null;
}

function esCalida_(f) { const m = Number(Utilities.formatDate(f, ZONA, 'M')); return m >= 3 && m <= 8; }

function diasEntre_(a, b) {
  const d = (f) => new Date(Utilities.formatDate(f, ZONA, 'yyyy-MM-dd') + 'T00:00:00');
  return Math.round((d(b) - d(a)) / 86400000);
}

function rangoDias_(min, max, unidad) {
  const k = { dia: 1, semana: 7, mes: 30, 'año': 365 }[String(unidad || '').toLowerCase()];
  const a = Number(min) > 0 ? Number(min) : 0, b = Number(max) > 0 ? Number(max) : 0;
  if (!k || (!a && !b)) return null;
  return (a && b ? (a + b) / 2 : (a || b)) * k;
}

function textoADias_(t) {
  t = String(t || '').toLowerCase();
  const m = t.match(/(\d+)(?:\s*[–-]\s*(\d+))?/);
  if (!m) return null;
  const v = (parseFloat(m[1]) + parseFloat(m[2] || m[1])) / 2;
  if (t.indexOf('sem') !== -1) return v * 7;
  if (t.indexOf('mes') !== -1) return v * 30;
  return v;
}

function frecuenciaRiego_(p, e, calida) {
  const f = FRECUENCIAS[calida ? 0 : 1];
  return rangoDias_(p[f[0]], p[f[1]], p[f[2]]) || textoADias_(p[f[3]]) ||
    (e && e.riego && e.riego[calida ? 'cv' : 'oi'] && rangoDias_(e.riego[calida ? 'cv' : 'oi'].min, e.riego[calida ? 'cv' : 'oi'].max, e.riego[calida ? 'cv' : 'oi'].unidad)) || 7;
}
