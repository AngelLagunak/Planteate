// ============================================================
// PLANTEATE 5.0 — cuidados.js: reglas de estado (portado de Cuidados.gs)
// ============================================================
// Mismas reglas que la V4, ahora en el móvil:
// - Frecuencia = media del rango mín–máx × días de la unidad.
// - Prioridad: datos de la planta > texto legado > catálogo de especie > defecto.
// - Nivel: rojo si se pasa; amarillo si queda ≤ 1/3; verde si no (o pospuesto).
// V5: abono + fertilizante se fusionan en "nutrir".

export const TIPOS = ['riego', 'nutrir', 'trasplante'];
export const EMOJI = { riego: '💧', nutrir: '🌿', trasplante: '🪴' };
export const ETIQUETA = { riego: 'Riego', nutrir: 'Nutrir', trasplante: 'Trasplante' };
export const VERBO = { riego: 'Regar', nutrir: 'Nutrir', trasplante: 'Trasplantar' };

const DIAS_POR_UNIDAD = { dia: 1, semana: 7, mes: 30, año: 365 };
const DEFECTO = { riego: 7, nutrir: 30, trasplante: 365 };

// tipoAccion de la hoja → cuidado V5
const TIPO_V5 = { riego: 'riego', abono: 'nutrir', fertilizante: 'nutrir', nutrir: 'nutrir', trasplante: 'trasplante' };
export const tipoV5 = (tipoAccion) => TIPO_V5[tipoAccion] || null;

export const COLS = {
  riego_cv: { min: 'Riego - intervalo mín (prim/verano)', max: 'Riego - intervalo máx (prim/verano)', unidad: 'Riego - unidad (prim/verano)', texto: 'Riego - primavera/verano' },
  riego_oi: { min: 'Riego - intervalo mín (oto/invierno)', max: 'Riego - intervalo máx (oto/invierno)', unidad: 'Riego - unidad (oto/invierno)', texto: 'Riego - otoño/invierno' },
  nutrir: { min: 'Abono - intervalo mín', max: 'Abono - intervalo máx', unidad: 'Abono - unidad', texto: 'Frecuencia abono' },
  fertilizante: { min: 'Fertilizante - intervalo mín', max: 'Fertilizante - intervalo máx', unidad: 'Fertilizante - unidad', texto: 'Frecuencia fertilizante' },
  trasplante: { min: 'Trasplante - intervalo mín', max: 'Trasplante - intervalo máx', unidad: 'Trasplante - unidad', texto: 'Trasplante' }
};

export function esTemporadaCalida(fecha = new Date()) {
  const m = fecha.getMonth() + 1;
  return m >= 3 && m <= 8;
}

export function estacion(fecha = new Date()) {
  const m = fecha.getMonth() + 1;
  if (m >= 3 && m <= 5) return { id: 'primavera', nombre: 'Primavera', emoji: '🌸' };
  if (m >= 6 && m <= 8) return { id: 'verano', nombre: 'Verano', emoji: '☀️' };
  if (m >= 9 && m <= 11) return { id: 'otono', nombre: 'Otoño', emoji: '🍂' };
  return { id: 'invierno', nombre: 'Invierno', emoji: '❄️' };
}

// ---------------------------------------------------------------
// Frecuencias
// ---------------------------------------------------------------
const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : null; };

/** {min,max,unidad} → días (media del rango). null si no hay datos. */
export function rangoADias(r) {
  if (!r) return null;
  const d = DIAS_POR_UNIDAD[String(r.unidad || '').trim().toLowerCase()];
  if (!d) return null;
  const a = num(r.min), b = num(r.max);
  if (a && b) return ((a + b) / 2) * d;
  return (a || b) ? (a || b) * d : null;
}

export function textoRango(r) {
  if (!r) return null;
  const nombres = { dia: ['día', 'días'], semana: ['semana', 'semanas'], mes: ['mes', 'meses'], año: ['año', 'años'] };
  const par = nombres[String(r.unidad || '').toLowerCase()];
  const a = num(r.min), b = num(r.max);
  if (!par || (!a && !b)) return null;
  if (a && b && a !== b) return `cada ${Math.min(a, b)}–${Math.max(a, b)} ${par[1]}`;
  const n = a || b;
  return `cada ${n} ${n === 1 ? par[0] : par[1]}`;
}

function rangoDePlanta(planta, clave) {
  const c = COLS[clave];
  return { min: planta[c.min], max: planta[c.max], unidad: planta[c.unidad] };
}

/** Texto libre legado: "Cada 2–4 sem", "1 vez al mes"... */
export function parseTexto(texto) {
  if (!texto) return null;
  const t = String(texto).toLowerCase();
  const m = t.match(/(\d+)(?:\s*[–-]\s*(\d+))?/);
  if (!m) return null;
  const media = (parseFloat(m[1]) + parseFloat(m[2] || m[1])) / 2;
  if (t.includes('sem')) return media * 7;
  if (t.includes('día') || t.includes('dia')) return media;
  if (t.includes('mes')) return t.includes('vez') || t.includes('veces') ? 30 / media : media * 30;
  if (t.includes('año') || t.includes('ano')) return t.includes('vez') || t.includes('veces') ? 365 / media : media * 365;
  return media;
}

/**
 * Rango que se aplica a esta planta para un cuidado, y de dónde sale.
 * Devuelve { dias, rango, fuente: 'planta'|'texto'|'especie'|'defecto' }.
 */
export function frecuencia(planta, especie, tipo, fecha = new Date()) {
  const calida = esTemporadaCalida(fecha);
  const claves = tipo === 'riego' ? [calida ? 'riego_cv' : 'riego_oi'] : tipo === 'nutrir' ? ['nutrir', 'fertilizante'] : ['trasplante'];

  for (const clave of claves) {
    const r = rangoDePlanta(planta, clave);
    const d = rangoADias(r);
    if (d) return { dias: d, rango: r, fuente: 'planta' };
  }
  for (const clave of claves) {
    const d = parseTexto(planta[COLS[clave].texto]);
    if (d) return { dias: d, rango: null, texto: planta[COLS[clave].texto], fuente: 'texto' };
  }
  if (especie) {
    const r = tipo === 'riego' ? especie.riego?.[calida ? 'cv' : 'oi'] : especie[tipo];
    const d = rangoADias(r);
    if (d) return { dias: d, rango: r, fuente: 'especie' };
  }
  return { dias: DEFECTO[tipo], rango: null, fuente: 'defecto' };
}

export function textoFrecuencia(f) {
  return (f.rango && textoRango(f.rango)) || f.texto || `cada ${Math.round(f.dias)} días`;
}

// ---------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export function diasEntre(a, b) {
  return Math.round((inicioDia(b) - inicioDia(a)) / 86400000);
}

// ---------------------------------------------------------------
// Historial
// ---------------------------------------------------------------
/** Acciones de cuidado de una planta, agrupadas por tipo V5, en orden ascendente. */
export function historialPorTipo(acciones, plantaId, { incluirInicio = false } = {}) {
  const out = { riego: [], nutrir: [], trasplante: [] };
  for (const a of acciones) {
    if (a.plantaId !== plantaId) continue;
    const t = tipoV5(a.tipoAccion);
    if (!t) continue;
    const esInicio = a.persona === 'Inicio Frecuencia';
    if (esInicio && !incluirInicio) continue;
    out[t].push({ fecha: new Date(a.timestamp), persona: esInicio ? '' : (a.persona || ''), inicio: esInicio, logId: a.logId, tipoAccion: a.tipoAccion });
  }
  TIPOS.forEach((t) => out[t].sort((x, y) => x.fecha - y.fecha));
  return out;
}

/** Índice plantaId → historial (con inicios), para calcular la portada de una pasada. */
export function indexarAcciones(acciones) {
  const idx = {};
  for (const a of acciones) {
    const t = tipoV5(a.tipoAccion);
    if (!t || !a.plantaId) continue;
    (idx[a.plantaId] ||= { riego: [], nutrir: [], trasplante: [] })[t].push(a);
  }
  return idx;
}

function ultimoDe(lista) {
  let mejor = null;
  for (const a of lista || []) {
    const f = new Date(a.timestamp);
    if (!isNaN(f) && (!mejor || f > mejor.fecha)) mejor = { fecha: f, persona: a.persona === 'Inicio Frecuencia' ? null : (a.persona || null) };
  }
  return mejor;
}

// ---------------------------------------------------------------
// Estado
// ---------------------------------------------------------------
export function nivel(diasPasados, freq) {
  if (!freq || diasPasados <= 0) return 'verde';
  const quedan = freq - diasPasados;
  if (quedan < 0) return 'rojo';
  if (quedan <= freq / 3) return 'amarillo';
  return 'verde';
}

/**
 * Estado de los 3 cuidados de una planta.
 * accionesPlanta: {riego:[], nutrir:[], trasplante:[]} con filas crudas.
 */
/** Fecha más antigua de cualquier cuidado de la planta, o su cumpleaños. */
function referenciaAlternativa(planta, accionesPlanta, inicioGlobal) {
  if (inicioGlobal) return new Date(inicioGlobal);
  let primera = null;
  for (const t of TIPOS) for (const a of accionesPlanta?.[t] || []) {
    const f = new Date(a.timestamp);
    if (!isNaN(f) && (!primera || f < primera)) primera = f;
  }
  const cumple = planta['Cumpleaños'] ? new Date(planta['Cumpleaños']) : null;
  if (cumple && !isNaN(cumple) && (!primera || cumple < primera)) return cumple;
  return primera;
}

export function estadoPlanta(planta, especie, accionesPlanta, inicioGlobal, ahora = new Date()) {
  const res = {};
  const pospuesto = planta.RiegoPospuestoHasta ? new Date(planta.RiegoPospuestoHasta) : null;
  const alternativa = referenciaAlternativa(planta, accionesPlanta, inicioGlobal);

  for (const tipo of TIPOS) {
    const f = frecuencia(planta, especie, tipo, ahora);
    const ultimo = ultimoDe(accionesPlanta?.[tipo]);
    // Sin registros de este cuidado: se cuenta desde el primer registro de la planta o su cumpleaños.
    const ref = ultimo?.fecha || alternativa;
    // Sep–feb casi ninguna planta de interior se abona: no avisar.
    const reposo = tipo === 'nutrir' && !esTemporadaCalida(ahora);

    if (!ref) {
      res[tipo] = { tipo, reposo, nivel: reposo ? 'verde' : 'rojo', sinReferencia: true, freq: f, diasDesde: null, diasRestantes: null, persona: null };
      continue;
    }
    const pasados = diasEntre(ref, ahora);
    const estaPospuesto = tipo === 'riego' && pospuesto && ahora < pospuesto;
    res[tipo] = {
      tipo,
      reposo,
      estimada: !ultimo,
      nivel: estaPospuesto || reposo ? 'verde' : nivel(pasados, f.dias),
      sinReferencia: false,
      freq: f,
      ultima: ref,
      diasDesde: pasados,
      diasRestantes: Math.ceil(f.dias - pasados),
      proxima: new Date(ref.getTime() + f.dias * 86400000),
      persona: ultimo?.persona || null,
      pospuestoHasta: estaPospuesto ? pospuesto : null
    };
  }

  res.color = res.riego.nivel;
  res.pendientes = TIPOS.filter((t) => res[t].nivel !== 'verde');
  return res;
}

export function textoEstado(c) {
  if (!c) return '';
  if (c.reposo) return '😴 En reposo hasta marzo';
  if (c.sinReferencia) return '⚠️ Sin fecha de referencia';
  if (c.pospuestoHasta) return `⏳ Pospuesto hasta el ${c.pospuestoHasta.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`;
  if (c.diasRestantes < 0) return `${ETIQUETA[c.tipo]} atrasado ${-c.diasRestantes} d`;
  if (c.diasRestantes === 0) return `${VERBO[c.tipo]} hoy`;
  if (c.diasRestantes === 1) return `${VERBO[c.tipo]} mañana`;
  return `${VERBO[c.tipo]} en ${c.diasRestantes} d`;
}

/** Intervalos reales entre registros consecutivos (para gráfico e insights). */
export function intervalos(lista) {
  const out = [];
  for (let i = 1; i < lista.length; i++) {
    out.push({ desde: lista[i - 1].fecha, hasta: lista[i].fecha, dias: diasEntre(lista[i - 1].fecha, lista[i].fecha), persona: lista[i].persona });
  }
  return out.filter((x) => x.dias > 0);
}
