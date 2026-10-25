// ============================================================
// PLANTEATE 5.0 — aprender.js: explicar y enseñar en el momento justo
// ============================================================
import { ETIQUETA, textoFrecuencia, estacion, esTemporadaCalida, intervalos, frecuencia } from './cuidados.js';

// ---------------------------------------------------------------
// Catálogo de especies
// ---------------------------------------------------------------
let base = [];
let especies = [];
export async function cargarEspecies() {
  const r = await fetch('data/especies.json');
  base = (await r.json()).especies;
  especies = base.slice();
  return especies;
}

/** Fichas creadas con IA (hoja "Especies"). El catálogo fijo manda si hay choque de id. */
export function registrarExtras(extras = []) {
  const ids = new Set(base.map((e) => e.id));
  especies = base.concat(extras.filter((e) => e?.id && !ids.has(e.id)));
}
export const listaEspecies = () => especies;
export const especiePorId = (id) => especies.find((e) => e.id === id) || null;

/** Busca la especie de una planta: columna especieId, o por género del nombre científico. */
export function especieDe(planta) {
  if (planta.especieId) { const e = especiePorId(planta.especieId); if (e) return e; }
  const nombre = String(planta['Nombre científico'] || planta['Género'] || '').trim().toLowerCase();
  if (!nombre) return null;
  const exacta = especies.find((e) => e.cientifico.toLowerCase() === nombre);
  if (exacta) return exacta;
  const genero = nombre.split(/\s+/)[0];
  // Sinónimos: nombres antiguos o alternativos (p. ej. Coleus = Plectranthus).
  const porSinonimo = (e) => (e.sinonimos || []).some((s) => { s = s.toLowerCase(); return s === nombre || s.split(/\s+/)[0] === genero; });
  return especies.find((e) => String(e.genero).toLowerCase() === genero) || especies.find(porSinonimo) || null;
}

// ---------------------------------------------------------------
// "¿Por qué?" de cada estado
// ---------------------------------------------------------------
const FUENTE = {
  planta: 'según la ficha de esta planta',
  texto: 'según la ficha de esta planta',
  especie: 'según lo típico de su especie',
  defecto: 'valor por defecto: no sabemos su especie, revisa la ficha'
};

export function porQue(c, especie) {
  const f = c.freq;
  const partes = [];
  if (c.sinReferencia) {
    return 'No hay ningún registro ni fecha de inicio, así que no se puede saber cuándo toca. Registra el próximo cuidado y el contador empezará.';
  }
  const hace = c.diasDesde === 0 ? 'hoy' : c.diasDesde === 1 ? 'ayer' : `hace ${c.diasDesde} días`;
  if (c.estimada) partes.push(`Aún no hay ningún registro de este cuidado, así que cuento desde su primer registro o su cumpleaños (${hace}). Cuando lo hagas, márcalo y el contador será exacto. Toca ${textoFrecuencia(f)}, ${FUENTE[f.fuente]}.`);
  else partes.push(`Último: ${hace}${c.persona ? ` (${c.persona})` : ''}. Toca ${textoFrecuencia(f)}, ${FUENTE[f.fuente]}.`);

  if (c.tipo === 'riego') {
    const calida = esTemporadaCalida();
    partes.push(calida
      ? 'Ahora es temporada cálida: crece y bebe más.'
      : 'Ahora es temporada fría: crece despacio y bebe menos, por eso el plazo es más largo.');
  }
  if (c.reposo) partes.push('De septiembre a febrero la planta crece poco y el abono se acumula en la tierra y quema raíces. Por eso no avisamos hasta marzo.');
  else if (c.pospuestoHasta) partes.push('La pospusiste porque la tierra seguía húmeda: eso cuenta más que el calendario.');
  else if (c.nivel === 'rojo') partes.push('Se ha pasado el plazo. Comprueba la tierra antes de actuar.');
  else if (c.nivel === 'amarillo') partes.push('Queda menos de un tercio del plazo.');

  if (c.tipo === 'riego' && especie?.riego?.comoSaber) partes.push('👉 ' + especie.riego.comoSaber);
  if (c.tipo === 'nutrir' && especie?.nutrir?.cuando) partes.push('👉 ' + especie.nutrir.cuando + '.');
  return partes.join(' ');
}

// ---------------------------------------------------------------
// Pista tras una acción
// ---------------------------------------------------------------
const PISTAS_GENERALES = {
  riego: [
    'Riega hasta que salga agua por abajo y tira lo que quede en el plato.',
    'El agua a temperatura ambiente estresa menos las raíces.',
    'Mejor regar a fondo y poco a menudo que un poco cada día.',
    'Una maceta seca pesa mucho menos: levántala y aprende a notarlo.'
  ],
  nutrir: [
    'Abona siempre con la tierra húmeda: en seco quema raíces.',
    'Menos es más: media dosis de lo que dice el envase suele bastar en interior.',
    'En otoño e invierno, la mayoría de plantas no necesitan abono.'
  ],
  trasplante: [
    'La nueva maceta, solo 2–4 cm más ancha. Más grande guarda demasiada agua.',
    'Tras trasplantar, espera unos días a abonar: las raíces se recuperan.',
    'La primavera es el mejor momento para trasplantar.'
  ],
  observacion: [
    'Observar es la mitad del cuidado. Con fotos y notas verás patrones.'
  ]
};

export function pistaTras(tipo, especie) {
  const propias = [];
  if (especie) {
    if (tipo === 'riego') propias.push(especie.riego?.comoSaber, ...(especie.pistas || []));
    if (tipo === 'nutrir') propias.push(especie.nutrir?.tipo && `Para ${especie.nombres[0]}: ${especie.nutrir.tipo}.`);
    if (tipo === 'trasplante') propias.push(especie.trasplante?.nota && `${especie.nombres[0]}: ${especie.trasplante.nota}.`, especie.sustrato && `Sustrato ideal: ${especie.sustrato}.`);
  }
  const todas = propias.filter(Boolean).concat(PISTAS_GENERALES[tipo] || []);
  return todas[Math.floor(Math.random() * todas.length)] || null;
}

// ---------------------------------------------------------------
// Consejo de temporada
// ---------------------------------------------------------------
const TEMPORADA = {
  primavera: 'Las plantas despiertan. Es buen momento para trasplantar, volver a abonar y acercarlas un poco a la luz.',
  verano: 'Calor: revisa la tierra más a menudo y aparta las plantas del sol directo tras el cristal, que quema.',
  otono: 'Los días acortan. Espacia los riegos, deja de abonar poco a poco y vigila las corrientes frías.',
  invierno: 'Reposo. Riega poco, no abones y aleja las plantas de la calefacción, que seca el aire.'
};
export function consejoTemporada(fecha = new Date()) {
  const e = estacion(fecha);
  return { ...e, texto: TEMPORADA[e.id] };
}

// ---------------------------------------------------------------
// Aprende de tu historial
// ---------------------------------------------------------------
export function insight(tipo, lista, planta, especie) {
  // Solo intervalos de la temporada actual: en riego, verano e invierno tienen objetivos distintos.
  const calida = esTemporadaCalida();
  const ints = intervalos(lista).filter((x) => tipo !== 'riego' || esTemporadaCalida(x.hasta) === calida).slice(-8);
  if (ints.length < 2) return null;
  const media = ints.reduce((s, x) => s + x.dias, 0) / ints.length;
  const f = frecuencia(planta, especie, tipo);
  const objetivo = f.dias;
  const nombre = ETIQUETA[tipo].toLowerCase();
  const desv = (media - objetivo) / objetivo;
  let texto = `${tipo === 'riego' ? `En temporada ${calida ? 'cálida' : 'fría'}, s` : 'S'}ueles hacer el ${nombre} cada ${Math.round(media)} días; el objetivo es ${textoFrecuencia(f)}.`;
  if (Math.abs(desv) <= 0.2) texto += ' Vas muy bien.';
  else if (desv > 0) texto += ' Vas más espaciado. Si la planta está sana, quizá su frecuencia real es más larga: puedes ajustar la ficha.';
  else texto += ' Vas más seguido. Si la tierra sigue húmeda al regar, espera más: el exceso de agua es la causa nº 1 de muerte en interior.';
  const personas = [...new Set(ints.map((x) => x.persona).filter(Boolean))];
  if (personas.length > 1) texto += ` Lo hacéis ${personas.join(' y ')}.`;
  return texto;
}

// ---------------------------------------------------------------
// Wikipedia (gratis, sin clave)
// ---------------------------------------------------------------
export async function resumenWikipedia(titulo) {
  if (!titulo) return null;
  const clave = 'pl5_wiki_' + titulo;
  try { const c = JSON.parse(localStorage.getItem(clave)); if (c) return c; } catch { /* sin caché */ }
  const r = await fetch('https://es.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(titulo.replace(/ /g, '_')));
  if (!r.ok) return null;
  const d = await r.json();
  const res = { texto: d.extract, url: d.content_urls?.desktop?.page, imagen: d.thumbnail?.source || null };
  try { localStorage.setItem(clave, JSON.stringify(res)); } catch { /* lleno */ }
  return res;
}

// ---------------------------------------------------------------
// Glosario
// ---------------------------------------------------------------
export const GLOSARIO = [
  ['Drenaje', 'Capacidad de la maceta y la tierra para dejar salir el agua sobrante. Sin agujero en la maceta no hay drenaje.'],
  ['Sustrato', 'La "tierra" de la maceta. Casi nunca es tierra de verdad: es una mezcla de turba, coco, corteza, perlita…'],
  ['Perlita', 'Roca volcánica expandida, blanca y ligera. Abre huecos de aire en el sustrato y mejora el drenaje.'],
  ['Pómice', 'Piedra volcánica porosa. Como la perlita pero más pesada y no flota. Muy usada en suculentas.'],
  ['Fibra de coco', 'Sustituto de la turba hecho de cáscara de coco. Retiene agua sin compactarse.'],
  ['NPK', 'Los tres números del abono: Nitrógeno (hojas), Fósforo (raíces y flores) y Potasio (salud y frutos). 10-10-10 = equilibrado.'],
  ['Luz indirecta', 'Luz que llega sin que el sol toque la hoja. Cerca de una ventana luminosa, pero fuera del rayo de sol.'],
  ['Luz tamizada', 'Sol filtrado por una cortina fina o un árbol. Más suave que el sol directo.'],
  ['Rizoma', 'Tallo engordado bajo tierra que guarda agua y reservas. La ZZ y muchas aráceas los tienen.'],
  ['Estolón', 'Tallo que crece rastrero y echa raíces más allá. Así se expanden la menta y la cinta.'],
  ['Esqueje', 'Trozo de tallo u hoja que se corta para que enraíce y forme una planta nueva.'],
  ['Pinzar', 'Cortar con los dedos la punta de un tallo para que la planta ramifique y quede más tupida.'],
  ['Suculenta', 'Planta que guarda agua en hojas, tallos o raíces gruesas. Aguanta sequía y odia el encharcamiento.'],
  ['Oxalatos de calcio', 'Cristales microscópicos en algunas plantas (aráceas). Irritan boca y garganta si se muerden.'],
  ['Subirrigación', 'Regar por abajo: poner agua en el plato y dejar que la tierra la suba. Se retira el resto a los 15–30 min.'],
  ['Reposo vegetativo', 'Época (normalmente invierno) en que la planta casi no crece. Necesita menos agua y nada de abono.'],
  ['Espata', 'Hoja modificada que rodea la inflorescencia. La "flor" blanca del espatifilo es una espata.'],
  ['Cepellón', 'El bloque de raíces y tierra que sale entero al sacar la planta de la maceta.']
];
