// ============================================================
// PLANTEATE 5.0 — app.js: pantallas y navegación
// ============================================================
// Navegación por hash (#/p/<id>, #/aprender…): el botón "atrás" del
// móvil funciona solo. Todas las acciones van por data-act="…" con un
// único listener de clics.

import * as S from './store.js';
import * as C from './cuidados.js';
import * as A from './aprender.js';
import * as Av from './avisos.js';

export const VERSION = '5.2.0';
const app = document.getElementById('app');
const ui = { filtro: null, seleccion: null, tab: 'cuidar', grafico: 'riego', wikiCargando: {}, agrupar: localStorage.getItem('pl5_agrupar') === '1', comparar: null };

// ---------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (d, opts = { day: 'numeric', month: 'short' }) => d ? new Date(d).toLocaleDateString('es-ES', opts) : '';
const hoyIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const ir = (ruta) => { location.hash = ruta; };
/** Solo se aceptan URLs de Apps Script: así un enlace malicioso no puede desviar tus datos a otro servidor. */
const urlApiValida = (u) => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(String(u || ''));
/** Enlaces externos solo https (evita javascript: si una fuente externa viniera manipulada). */
const urlSegura = (u) => (/^https:\/\//.test(String(u || '')) ? u : '#');

/** Aviso abajo. `deshacer`: logIds que el botón Deshacer puede anular. */
function toast(texto, { pista = null, ms = 4500, deshacer = null } = {}) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  if (deshacer) ui.deshacer = deshacer;
  el.innerHTML = `<div class="toast-fila"><div>${h(texto)}</div>${deshacer ? '<button class="toast-btn" data-act="deshacer">Deshacer</button>' : ''}</div>${pista ? `<div class="toast-pista">💡 ${h(pista)}</div>` : ''}`;
  document.body.appendChild(el);
  const dura = (pista ? ms + 3000 : ms) + (deshacer ? 2000 : 0);
  setTimeout(() => el.classList.add('fuera'), dura);
  setTimeout(() => el.remove(), dura + 400);
}

/** <img> de una foto. El src se rellena después (las fotos privadas llegan de la API o del móvil). */
function imgFoto(f, attrs = '') {
  return `<img data-foto="${h(f.fotoId || '')}" ${f.url ? `src="${h(f.url)}"` : ''} alt="" loading="lazy" ${attrs}>`;
}

let fotosIndex = new Map();
let instalable = null; // evento beforeinstallprompt de Chrome
function cargarFotos() {
  document.querySelectorAll('img[data-foto]:not([src])').forEach((img) => {
    const f = fotosIndex.get(img.dataset.foto);
    if (!f) return;
    img.classList.add('cargando');
    S.urlFoto(f).then((url) => { if (url) img.src = url; }).catch((e) => console.warn('Foto:', e)).finally(() => img.classList.remove('cargando'));
  });
}

function modal(html, { cerrable = true } = {}) {
  cerrarModal();
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
  if (cerrable) fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrarModal(); });
  document.body.appendChild(fondo);
  fondo.querySelector('input,textarea')?.focus();
  return fondo;
}
function cerrarModal() { document.querySelector('.modal-fondo')?.remove(); }

/** Foto → JPEG comprimido en base64 (respeta la orientación EXIF). */
async function comprimirFoto(file, lado = 1280) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: dataUrl.split(',')[1], mime: 'image/jpeg', dataUrl };
}

// Sin "capture": así Android deja elegir entre cámara y galería.
function pedirFoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// ---------------------------------------------------------------
// Datos derivados
// ---------------------------------------------------------------
function datos() {
  const v = S.vista();
  A.registrarExtras(v.especiesExtra);
  fotosIndex = new Map(v.fotos.map((f) => [f.fotoId, f]));
  const idx = C.indexarAcciones(v.acciones);
  const ultimaFoto = {};
  for (const f of v.fotos) if (!ultimaFoto[f.plantaId] || f.timestamp > ultimaFoto[f.plantaId].timestamp) ultimaFoto[f.plantaId] = f;

  const plantas = v.plantas.filter((p) => p.id).map((p) => {
    const especie = A.especieDe(p);
    return {
      ...p,
      nombre: p['Nombre Casa'] || 'Sin nombre',
      archivada: String(p.Archivada).toUpperCase() === 'TRUE',
      especie,
      estado: C.estadoPlanta(p, especie, idx[p.id], v.inicioGlobal),
      foto: ultimaFoto[p.id] || (p['Foto principal'] ? { url: p['Foto principal'], urlGrande: p['Foto principal'] } : null)
    };
  });
  return { v, plantas, activas: plantas.filter((p) => !p.archivada), archivadas: plantas.filter((p) => p.archivada) };
}

const PESO = { rojo: 0, amarillo: 1, verde: 2 };
const porUrgencia = (a, b) => (PESO[a.estado.color] - PESO[b.estado.color]) || ((a.estado.riego.diasRestantes ?? -999) - (b.estado.riego.diasRestantes ?? -999)) || a.nombre.localeCompare(b.nombre);

// ---------------------------------------------------------------
// Marco: cabecera + navegación inferior
// ---------------------------------------------------------------
function indicadorSync() {
  const s = S.infoSync();
  if (S.esDemo()) return `<button class="sync sync-demo" data-act="ir" data-ruta="#/ajustes">Modo prueba</button>`;
  const txt = { ok: s.pendientes ? `${s.pendientes} por enviar` : 'Al día', enviando: 'Guardando…', error: s.pendientes ? 'Sin guardar' : 'Sin actualizar', offline: s.pendientes ? `Sin red · ${s.pendientes} pendientes` : 'Sin red' }[s.estado];
  return `<button class="sync sync-${s.estado}" data-act="sync" title="${h(s.error || '')}"><span class="punto"></span>${txt}</button>`;
}

function marco(contenido, activa, { titulo = null, volver = false, extra = '' } = {}) {
  const persona = S.persona();
  const cab = titulo
    ? `<header class="barra">
        ${volver ? '<button class="btn-icono" data-act="volver" aria-label="Volver">←</button>' : ''}
        <h1 class="barra-titulo">${titulo}</h1>
        ${extra}
      </header>`
    : '';
  const nav = [
    ['#/', '🪴', 'Plantas', 'home'],
    ['#/calendario', '📅', 'Calendario', 'cal'],
    ['#/aprender', '📖', 'Aprender', 'aprender'],
    ['#/ajustes', persona ? h(persona[0].toUpperCase()) : '⚙️', 'Ajustes', 'ajustes']
  ].map(([r, ic, t, id]) => `<a href="${r}" class="nav-item ${activa === id ? 'activa' : ''}"><span class="nav-ic">${ic}</span>${t}</a>`).join('');
  return `${cab}<main class="contenido">${contenido}</main><nav class="nav">${nav}</nav>`;
}

// ---------------------------------------------------------------
// Portada
// ---------------------------------------------------------------
function vistaHome() {
  const { activas } = datos();
  const est = C.estacion();
  const consejo = A.consejoTemporada();
  const consejoOculto = localStorage.getItem('pl5_consejo_visto') === consejo.id + new Date().getFullYear();

  const conteo = Object.fromEntries(C.TIPOS.map((t) => [t, activas.filter((p) => p.estado[t].nivel !== 'verde').length]));
  let lista = activas.slice().sort(porUrgencia);
  if (ui.filtro) lista = lista.filter((p) => p.estado[ui.filtro].nivel !== 'verde');

  const chips = C.TIPOS.map((t) => `<button class="chip ${ui.filtro === t ? 'on' : ''}" data-act="filtro" data-tipo="${t}">${C.EMOJI[t]} ${C.ETIQUETA[t]} <b>${conteo[t]}</b></button>`).join('');
  const sel = ui.seleccion;

  const cabecera = `
    <header class="portada-cab">
      <div>
        <h1>Planteate</h1>
        <div class="sub">${activas.length} plantas · ${est.emoji} ${est.nombre}</div>
      </div>
      ${indicadorSync()}
    </header>`;

  const tarjetaConsejo = consejoOculto ? '' : `
    <div class="consejo">
      <div><b>${consejo.emoji} ${consejo.nombre}.</b> ${h(consejo.texto)}</div>
      <button class="btn-icono peq" data-act="ocultar-consejo" aria-label="Ocultar">✕</button>
    </div>`;

  const barraSel = sel ? `
    <div class="barra-seleccion">
      <span>${sel.size} elegidas</span>
      ${C.TIPOS.map((t) => `<button class="btn peq" data-act="accion-masiva" data-tipo="${t}" ${sel.size ? '' : 'disabled'}>${C.EMOJI[t]} ${C.VERBO[t]}</button>`).join('')}
      <button class="btn peq claro" data-act="seleccion">Cancelar</button>
    </div>` : '';

  // Agrupar por "Ubicación": cada sitio con su rejilla; con "Varias" se puede elegir el grupo entero.
  const hayUbicaciones = activas.some((p) => String(p['Ubicación'] || '').trim());
  let rejillas = `<div class="rejilla">${lista.map(tarjeta).join('')}</div>`;
  if (ui.agrupar && hayUbicaciones) {
    const grupos = new Map();
    lista.forEach((p) => { const k = String(p['Ubicación'] || '').trim() || 'Sin sitio'; grupos.set(k, [...(grupos.get(k) || []), p]); });
    rejillas = [...grupos.keys()].sort((a, b) => (a === 'Sin sitio') - (b === 'Sin sitio') || a.localeCompare(b)).map((k) => {
      const ps = grupos.get(k);
      const pend = ps.filter((p) => p.estado.riego.nivel !== 'verde').length;
      return `<div class="grupo-cab"><h3>${h(k)}</h3><span class="sub">${ps.length} ${ps.length === 1 ? 'planta' : 'plantas'}${pend ? ` · 💧 ${pend}` : ''}</span>
        ${sel ? `<button class="chip" data-act="marcar-grupo" data-ids="${h(ps.map((p) => p.id).join(','))}">Elegir todas</button>` : ''}</div>
        <div class="rejilla">${ps.map(tarjeta).join('')}</div>`;
    }).join('');
  }

  const vacia = !activas.length
    ? `<div class="vacio"><div class="vacio-ic">🌱</div><p>Todavía no hay plantas.</p><button class="btn" data-act="ir" data-ruta="#/nueva">Añadir la primera</button></div>`
    : !lista.length ? `<div class="vacio"><p>Ninguna necesita ${C.ETIQUETA[ui.filtro].toLowerCase()}. 🎉</p></div>` : '';

  return marco(`
    ${cabecera}
    ${tarjetaConsejo}
    <div class="chips">${chips}<button class="chip ${sel ? 'on' : ''}" data-act="seleccion">☑️ Varias</button>${hayUbicaciones ? `<button class="chip ${ui.agrupar ? 'on' : ''}" data-act="agrupar">🏠 Por sitio</button>` : ''}</div>
    ${barraSel}
    ${rejillas}
    ${vacia}
    <button class="fab" data-act="ir" data-ruta="#/nueva" aria-label="Nueva planta">+</button>
  `, 'home');
}

function tarjeta(p) {
  const c = p.estado.riego;
  const sel = ui.seleccion;
  const marcada = sel?.has(p.id);
  const foto = p.foto ? imgFoto(p.foto) : `<span class="sin-foto">🌿</span>`;
  const emojis = p.estado.pendientes.filter((t) => t !== 'riego').map((t) => C.EMOJI[t]).join('');
  const regarRapido = !sel && c.nivel !== 'verde'
    ? `<button class="regar-rapido" data-act="cuidar" data-id="${h(p.id)}" data-tipo="riego" aria-label="Regar ${h(p.nombre)}">💧</button>` : '';
  return `
    <div class="tarjeta borde-${p.estado.color} ${marcada ? 'marcada' : ''}" data-act="${sel ? 'marcar' : 'abrir'}" data-id="${h(p.id)}">
      <div class="tarjeta-foto">${foto}${emojis ? `<span class="esquina">${emojis}</span>` : ''}${sel ? `<span class="check">${marcada ? '✓' : ''}</span>` : ''}${regarRapido}</div>
      <div class="tarjeta-info">
        <div class="tarjeta-nombre">${h(p.nombre)}${p._pendiente ? ' <span class="pend" title="Pendiente de guardar">•</span>' : ''}</div>
        <div class="tarjeta-esp">${h(p.especie?.nombres[0] || p['Nombre científico'] || '')}</div>
        <div class="tarjeta-estado nivel-${c.nivel}">${C.textoEstado(c)}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
// Ficha de planta
// ---------------------------------------------------------------
function vistaDetalle(id) {
  const { v, plantas } = datos();
  const p = plantas.find((x) => x.id === id);
  if (!p) return marco('<div class="vacio"><p>Planta no encontrada.</p><a class="btn" href="#/">Volver</a></div>', 'home', { titulo: 'Planta', volver: true });

  const fotos = v.fotos.filter((f) => f.plantaId === id).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const hist = C.historialPorTipo(v.acciones, id);
  const hero = fotos[0] || p.foto;

  const estados = C.TIPOS.map((t) => {
    const c = p.estado[t];
    return `
      <details class="estado-fila nivel-${c.nivel}">
        <summary><span class="estado-ic">${C.EMOJI[t]}</span><span class="estado-txt">${C.textoEstado(c)}</span><span class="porque">¿por qué?</span></summary>
        <p>${h(A.porQue(c, p.especie))}</p>
      </details>`;
  }).join('');

  const sellos = hist.riego.slice(-10).reverse().map((r) => `<div class="sello"><b>${r.fecha.getDate()}</b><span>${fecha(r.fecha, { month: 'short' })}</span><i>${h((r.persona || '·')[0])}</i></div>`).join('');

  const tabs = [['cuidar', '🌱 Cuidar'], ['conocela', '📖 Conócela'], ['historial', '📊 Historial'], ['fotos', `📷 Fotos${fotos.length ? ` (${fotos.length})` : ''}`]]
    .map(([k, t]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${t}</button>`).join('');

  const cuerpo = { cuidar: tabCuidar, conocela: tabConocela, historial: tabHistorial, fotos: tabFotos }[ui.tab](p, { v, hist, fotos });

  return marco(`
    <div class="hero" ${hero ? `data-act="foto-grande" data-foto-id="${h(hero.fotoId || '')}"` : `data-act="subir-foto" data-id="${h(id)}"`}>
      ${hero ? imgFoto(hero, 'loading="eager"') : '<span>📷 Añadir foto</span>'}
    </div>
    <div class="ficha-cab">
      <h2>${h(p.nombre)}</h2>
      <div class="sub"><i>${h(p['Nombre científico'] || p.especie?.cientifico || 'Especie sin indicar')}</i>${p['Ubicación'] ? ` · 🏠 ${h(p['Ubicación'])}` : ''}${p.archivada ? ' · 📦 Archivada' : ''}</div>
    </div>
    ${p.especie
      ? `<button class="aprende-banda" data-act="tab" data-tab="conocela" data-scroll="1"><span>📖</span><div><b>Conoce a tu ${h(p.especie.nombres[0])}</b><small>${h(p.especie.curiosidad || p.especie.origen || '')}</small></div><span>›</span></button>`
      : `<button class="aprende-banda aviso" data-act="tab" data-tab="conocela" data-scroll="1"><span>❓</span><div><b>¿Qué planta es?</b><small>Dime su especie y te enseño a cuidarla.</small></div><span>›</span></button>`}
    ${p.archivada ? '' : `
    <div class="acciones-principales">
      <button class="btn grande" data-act="cuidar" data-id="${h(id)}" data-tipo="riego">💧 Regar hoy</button>
      <button class="btn claro" data-act="posponer" data-id="${h(id)}">⏳ Sigue húmeda</button>
    </div>
    <div class="acciones-sec">
      <button class="btn claro peq" data-act="cuidar" data-id="${h(id)}" data-tipo="nutrir">🌿 Nutrir</button>
      <button class="btn claro peq" data-act="cuidar" data-id="${h(id)}" data-tipo="trasplante">🪴 Trasplantar</button>
      <button class="btn claro peq" data-act="observar" data-id="${h(id)}">📝 Observar</button>
      <button class="btn claro peq" data-act="preguntar" data-id="${h(id)}">💬 Pregúntale</button>
    </div>`}
    <section class="estados">${estados}</section>
    ${sellos ? `<div class="sellos">${sellos}</div>` : ''}
    <div class="tabs" id="tabs">${tabs}</div>
    <section class="tab-cuerpo">${cuerpo}</section>
  `, 'home', { titulo: h(p.nombre), volver: true, extra: `<button class="btn-icono" data-act="ir" data-ruta="#/p/${h(id)}/editar" aria-label="Editar">✏️</button>` });
}

function fila(etq, valor) {
  return valor ? `<div class="dato"><span>${etq}</span><div>${h(valor)}</div></div>` : '';
}

function tabCuidar(p) {
  const e = p.especie;
  const f = (t) => C.frecuencia(p, e, t);
  const ahora = new Date();
  const fCv = C.frecuencia(p, e, 'riego', new Date(ahora.getFullYear(), 5, 1));
  const fOi = C.frecuencia(p, e, 'riego', new Date(ahora.getFullYear(), 0, 1));
  const origen = (x) => x.fuente === 'especie' ? ' <small>(especie)</small>' : x.fuente === 'defecto' ? ' <small>(por defecto)</small>' : '';
  const tox = p['Toxicidad mascotas'] || e?.toxicidad;

  return `
    <div class="tarjeta-bloque">
      <h3>Frecuencias</h3>
      <div class="dato"><span>💧 Primavera–verano</span><div>${h(C.textoFrecuencia(fCv))}${origen(fCv)}</div></div>
      <div class="dato"><span>💧 Otoño–invierno</span><div>${h(C.textoFrecuencia(fOi))}${origen(fOi)}</div></div>
      <div class="dato"><span>🌿 Nutrir</span><div>${h(C.textoFrecuencia(f('nutrir')))}${origen(f('nutrir'))}</div></div>
      <div class="dato"><span>🪴 Trasplante</span><div>${h(C.textoFrecuencia(f('trasplante')))}${origen(f('trasplante'))}</div></div>
    </div>
    <div class="tarjeta-bloque">
      <h3>Cómo cuidarla</h3>
      ${fila('Riego', [p['Riego - cantidad'] || e?.riego?.cantidad, p['Riego - método'] || e?.riego?.metodo].filter(Boolean).join(' · '))}
      ${fila('Luz', [p['Luz - tipo'] || e?.luz?.tipo, p['Luz - exposición'] || e?.luz?.exposicion].filter(Boolean).join(' · '))}
      ${fila('Sustrato', p['Sustrato'] || e?.sustrato)}
      ${fila('Abono', p['Fertilizante - tipo'] || e?.nutrir?.tipo)}
      ${fila('Temperatura', p['Temperatura - nota'] || e?.temperatura)}
      ${tox ? `<div class="dato ${/no t[oó]xica/i.test(tox) ? '' : 'aviso'}"><span>Mascotas</span><div>${h(tox)}</div></div>` : ''}
      ${fila('Notas', p['Notas agronómicas'])}
      ${!e && !p['Sustrato'] ? '<p class="nota">Elige su especie en ✏️ Editar y aquí aparecerán sus cuidados.</p>' : ''}
    </div>
    <div class="tarjeta-bloque">
      <h3>Datos</h3>
      ${fila('Cumpleaños', p['Cumpleaños'] ? fecha(p['Cumpleaños'], { day: 'numeric', month: 'long', year: 'numeric' }) : '')}
      ${fila('Origen', p.Origen)}
      ${fila('Ubicación', p['Ubicación'])}
      ${p.archivada ? fila('Archivada', `${p.MotivoArchivado || ''} · ${fecha(p.FechaArchivado)}`) : ''}
    </div>
    <div class="tarjeta-bloque">
      <h3>Notas personales</h3>
      <textarea id="nota" rows="3" placeholder="Lo que quieras recordar de esta planta…">${h(p.NotaPersonal || '')}</textarea>
      <button class="btn peq" data-act="guardar-nota" data-id="${h(p.id)}">Guardar nota</button>
    </div>
    <div class="pie-ficha">
      ${p.archivada
        ? `<button class="btn claro" data-act="restaurar" data-id="${h(p.id)}">↩️ Restaurar planta</button>`
        : `<button class="btn claro peligro" data-act="archivar" data-id="${h(p.id)}">📦 Archivar</button>`}
    </div>`;
}

function tabConocela(p) {
  const e = p.especie;
  if (!e) {
    const cientifico = String(p['Nombre científico'] || '').trim();
    return `<div class="tarjeta-bloque"><h3>¿Qué planta es?</h3>
      <p>Elige su especie del catálogo y te cuento cómo cuidarla y por qué.</p>
      <select id="elegir-especie"><option value="">— Elegir especie —</option>${A.listaEspecies().map((x) => `<option value="${h(x.id)}">${h(x.nombres[0])} (${h(x.cientifico)})</option>`).join('')}</select>
      <button class="btn peq" data-act="asignar-especie" data-id="${h(p.id)}">Guardar</button>
      <h3>¿No está en la lista?</h3>
      ${cientifico
        ? `<p>Puedo crear la ficha de <i>${h(cientifico)}</i> con IA. Revísala después: es orientativa.</p>
           <button class="btn peq claro" data-act="crear-ficha" data-id="${h(p.id)}" data-nombre="${h(cientifico)}">✨ Crear ficha con IA</button>`
        : `<p>Ponle el nombre científico en ✏️ Editar (o identifícala con una foto al crearla) y podré crear su ficha.</p>`}
      </div>`;
  }
  return bloqueEspecie(e) + `<p class="centro"><button class="btn claro peq" data-act="preguntar" data-id="${h(p.id)}">💬 Pregúntale algo sobre ella</button></p>`;
}

function bloqueEspecie(e) {
  const wiki = ui.wikiCargando[e.wiki];
  if (wiki === undefined && e.wiki) {
    ui.wikiCargando[e.wiki] = null;
    A.resumenWikipedia(e.wiki).then((r) => { ui.wikiCargando[e.wiki] = r || false; pintar(); }).catch(() => { ui.wikiCargando[e.wiki] = false; });
  }
  const parrafo = (titulo, texto) => texto ? `<h3>${titulo}</h3><p>${h(texto)}</p>` : '';
  const listaHtml = (titulo, xs) => xs?.length ? `<h3>${titulo}</h3><ul>${xs.filter(Boolean).map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : '';
  return `
    <div class="tarjeta-bloque aprender">
      <div class="esp-cab"><b>${h((e.nombres || []).join(' · '))}</b><i>${h(e.cientifico)}${e.familia ? ' · ' + h(e.familia) : ''}</i>
        ${e.generadaConIA ? '<span class="etiqueta-ia">✨ Ficha creada con IA: orientativa</span>' : ''}</div>
      ${parrafo('🌍 De dónde viene', e.origen)}
      ${parrafo('🤔 Por qué se cuida así', e.porQue)}
      ${parrafo('💧 Cómo saber si necesita agua', e.riego?.comoSaber)}
      ${listaHtml('⚠️ Errores típicos', e.errores)}
      ${listaHtml('💡 Trucos', e.pistas)}
      ${parrafo('✨ Curiosidad', e.curiosidad)}
      ${wiki ? `<h3>📚 Wikipedia</h3>${wiki.imagen ? `<img class="wiki-img" src="${h(wiki.imagen)}" alt="" loading="lazy">` : ''}<p>${h(wiki.texto)}</p><a href="${h(urlSegura(wiki.url))}" target="_blank" rel="noopener noreferrer">Leer más en Wikipedia ↗</a>`
        : wiki === null ? '<p class="nota">Cargando Wikipedia…</p>' : ''}
    </div>`;
}

function tabHistorial(p, { v, hist }) {
  const tipo = ui.grafico;
  const c = p.estado[tipo];
  const lista = hist[tipo];
  const ins = A.insight(tipo, lista, p, p.especie);
  const selector = C.TIPOS.map((t) => `<button class="chip ${t === tipo ? 'on' : ''}" data-act="grafico" data-tipo="${t}">${C.EMOJI[t]} ${C.ETIQUETA[t]}</button>`).join('');

  const eventos = v.acciones
    .filter((a) => a.plantaId === p.id && a.persona !== 'Inicio Frecuencia')
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 40)
    .map((a) => {
      const t = C.tipoV5(a.tipoAccion);
      const ic = t ? C.EMOJI[t] : { observacion: '📝', diagnostico: '🩺', identificacion: '🔎' }[a.tipoAccion] || '•';
      const nombre = t ? C.ETIQUETA[t] : { observacion: 'Observación', diagnostico: 'Diagnóstico', identificacion: 'Identificación' }[a.tipoAccion] || a.tipoAccion;
      return `<li><span class="ev-ic">${ic}</span><div><b>${h(nombre)}</b> · ${fecha(a.timestamp, { day: 'numeric', month: 'short', year: '2-digit' })}${a.persona ? ` · ${h(a.persona)}` : ''}${a.detalle ? `<div class="ev-det">${h(a.detalle)}</div>` : ''}</div></li>`;
    }).join('');

  return `
    <div class="tarjeta-bloque">
      <h3>Frecuencia real</h3>
      <div class="chips">${selector}</div>
      ${grafico(lista, c)}
      ${ins ? `<p class="insight">💡 ${h(ins)}</p>` : ''}
    </div>
    <div class="tarjeta-bloque">
      <h3>Línea de tiempo</h3>
      ${eventos ? `<ul class="eventos">${eventos}</ul>` : '<p class="nota">Aún no hay registros.</p>'}
    </div>`;
}

function grafico(lista, c) {
  const ints = C.intervalos(lista).slice(-12);
  if (ints.length < 1) return '<p class="nota">Hacen falta al menos 2 registros para ver el gráfico.</p>';
  const obj = c.freq.dias;
  const max = Math.max(obj, ...ints.map((x) => x.dias)) * 1.15;
  const W = 320, H = 150, pad = 22, bw = (W - pad) / ints.length;
  const y = (d) => H - 18 - (d / max) * (H - 30);
  const barras = ints.map((x, i) => {
    const col = x.dias <= obj ? 'var(--verde)' : x.dias <= obj * 1.15 ? 'var(--ambar)' : 'var(--rojo)';
    const bx = pad + i * bw + bw * 0.15;
    return `<rect x="${bx}" y="${y(x.dias)}" width="${bw * 0.7}" height="${H - 18 - y(x.dias)}" rx="3" fill="${col}"><title>${x.dias} días (${fecha(x.hasta)})</title></rect>
      <text x="${bx + bw * 0.35}" y="${y(x.dias) - 3}" class="g-num">${x.dias}</text>
      <text x="${bx + bw * 0.35}" y="${H - 4}" class="g-fecha">${x.hasta.getDate()}/${x.hasta.getMonth() + 1}</text>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Días entre registros">
    ${barras}
    <line x1="${pad}" x2="${W}" y1="${y(obj)}" y2="${y(obj)}" class="g-obj"/>
    <text x="2" y="${y(obj) + 3}" class="g-num">${Math.round(obj)}</text>
  </svg><div class="leyenda"><span class="l-verde">a tiempo</span><span class="l-ambar">algo tarde</span><span class="l-rojo">tarde</span><span>– – objetivo</span></div>`;
}

function tabFotos(p, { fotos }) {
  const diag = ui.diagnostico?.id === p.id ? ui.diagnostico : null;
  const fechaLarga = (t) => fecha(t, { day: 'numeric', month: 'short', year: '2-digit' });
  let comparador = '';
  if (fotos.length >= 2 && ui.comparar?.id === p.id) {
    // fotos va de más nueva a más vieja: por defecto, la más antigua frente a la más reciente.
    const a = fotosIndex.get(ui.comparar.a) || fotos[fotos.length - 1];
    const b = fotosIndex.get(ui.comparar.b) || fotos[0];
    const opciones = (sel) => fotos.map((f) => `<option value="${h(f.fotoId)}" ${f.fotoId === sel ? 'selected' : ''}>${fechaLarga(f.timestamp)}</option>`).join('');
    const dias = Math.abs(C.diasEntre(new Date(a.timestamp), new Date(b.timestamp)));
    comparador = `<div class="tarjeta-bloque comparar">
      <h3>↔️ Antes y después · ${dias} días</h3>
      <div class="comparar-par">
        <div>${imgFoto(a)}<select data-cambio="comparar-a">${opciones(a.fotoId)}</select></div>
        <div>${imgFoto(b)}<select data-cambio="comparar-b">${opciones(b.fotoId)}</select></div>
      </div>
      <p class="nota">Fíjate en hojas nuevas, color y si se inclina hacia la luz.</p>
    </div>`;
  }
  return `
    <div class="acciones-sec">
      <button class="btn peq" data-act="subir-foto" data-id="${h(p.id)}">📷 Añadir foto</button>
      <button class="btn claro peq" data-act="diagnosticar" data-id="${h(p.id)}">🩺 ¿Cómo está de salud?</button>
      ${fotos.length >= 2 ? `<button class="btn claro peq" data-act="comparar" data-id="${h(p.id)}">↔️ ${ui.comparar?.id === p.id ? 'Cerrar comparación' : 'Comparar'}</button>` : ''}
    </div>
    ${diag ? `<div class="tarjeta-bloque diag">${diag.cargando ? '<p>Analizando la foto…</p>' : diag.html}</div>` : ''}
    ${comparador}
    <div class="fotos">${fotos.map((f) => `
      <div class="foto-mini">
        ${imgFoto(f, `data-act="foto-grande" data-foto-id="${h(f.fotoId)}"`)}
        <span>${fechaLarga(f.timestamp)}${f._pendiente ? ' · ⏳ sin subir' : ''}</span>
        <button class="btn-icono peq" data-act="borrar-foto" data-foto-borrar="${h(f.fotoId)}" aria-label="Borrar">🗑</button>
      </div>`).join('') || '<p class="nota">Sin fotos. Una foto cada mes enseña mucho: verás cómo crece.</p>'}</div>`;
}

// ---------------------------------------------------------------
// Formulario: nueva / editar
// ---------------------------------------------------------------
const UNIDADES = [['', '—'], ['dia', 'días'], ['semana', 'semanas'], ['mes', 'meses'], ['año', 'años']];
const ORIGENES = ['', 'Comprada', 'Regalo', 'Donación', 'Esqueje o propagación', 'Otro'];
const GRUPOS_FREQ = [['riego_cv', '💧 Riego primavera–verano', 'cv'], ['riego_oi', '💧 Riego otoño–invierno', 'oi'], ['nutrir', '🌿 Nutrir', 'nutrir'], ['trasplante', '🪴 Trasplante', 'trasplante']];

function selectEspecie(actual) {
  return `<select name="especieId" id="f-especie"><option value="">— No sé / otra —</option>${A.listaEspecies().map((e) => `<option value="${h(e.id)}" ${actual === e.id ? 'selected' : ''}>${h(e.nombres[0])} — ${h(e.cientifico)}</option>`).join('')}</select>`;
}

function vistaNueva() {
  const id = ui.borrador || {};
  return marco(`
    <form class="formulario" id="form-nueva">
      <button type="button" class="btn claro" data-act="identificar">📷 Identificar con una foto</button>
      <div id="candidatos">${ui.candidatos || ''}</div>
      <label>Nombre en casa *<input name="Nombre Casa" required maxlength="100" value="${h(id['Nombre Casa'] || '')}" placeholder="p. ej. Lirio del salón"></label>
      <label>Especie ${selectEspecie(id.especieId)}</label>
      <label>Nombre científico<input name="Nombre científico" value="${h(id['Nombre científico'] || '')}"></label>
      <label>Ubicación<input name="Ubicación" value="${h(id['Ubicación'] || '')}" placeholder="Salón, ventana norte…"></label>
      <div class="dos">
        <label>Cumpleaños<input type="date" name="Cumpleaños" value="${hoyIso()}"></label>
        <label>Origen<select name="Origen">${ORIGENES.map((o) => `<option ${o === 'Comprada' ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      </div>
      <p class="nota">Los cuidados salen de la especie. Podrás ajustarlos luego en ✏️ Editar.</p>
      <button class="btn grande" type="submit">🌱 Crear planta</button>
    </form>`, 'home', { titulo: 'Nueva planta', volver: true });
}

function vistaEditar(id) {
  const { plantas } = datos();
  const p = plantas.find((x) => x.id === id);
  if (!p) return vistaDetalle(id);
  const e = p.especie;

  const freqs = GRUPOS_FREQ.map(([clave, titulo, eClave]) => {
    const cols = C.COLS[clave];
    const ref = eClave === 'cv' || eClave === 'oi' ? e?.riego?.[eClave] : e?.[eClave];
    const ph = ref ? C.textoRango(ref) : '';
    return `<fieldset><legend>${titulo}</legend>
      <div class="tres">
        <label>mín<input type="number" min="0" step="any" name="${h(cols.min)}" value="${h(p[cols.min] ?? '')}"></label>
        <label>máx<input type="number" min="0" step="any" name="${h(cols.max)}" value="${h(p[cols.max] ?? '')}"></label>
        <label>unidad<select name="${h(cols.unidad)}">${UNIDADES.map(([v, t]) => `<option value="${v}" ${String(p[cols.unidad] || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      ${ph ? `<small>Vacío = lo de su especie (${h(ph)})</small>` : ''}</fieldset>`;
  }).join('');

  const texto = (col, etq, ph = '') => `<label>${etq}<input name="${h(col)}" value="${h(p[col] ?? '')}" placeholder="${h(ph)}"></label>`;
  const cumple = p['Cumpleaños'] ? new Date(p['Cumpleaños']) : null;

  return marco(`
    <form class="formulario" id="form-editar" data-id="${h(id)}">
      ${texto('Nombre Casa', 'Nombre en casa *')}
      <label>Especie ${selectEspecie(e?.id)}</label>
      ${texto('Nombre científico', 'Nombre científico')}
      ${texto('Ubicación', 'Ubicación', 'Salón, ventana norte…')}
      <div class="dos">
        <label>Cumpleaños<input type="date" name="Cumpleaños" value="${cumple && !isNaN(cumple) ? cumple.toISOString().slice(0, 10) : ''}"></label>
        <label>Origen<select name="Origen">${ORIGENES.map((o) => `<option ${o === (p.Origen || '') ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      </div>
      <h3>Frecuencias</h3>
      <p class="nota">Si solo sabes un número, ponlo en mín y máx.</p>
      ${freqs}
      <details><summary>Más datos (opcional)</summary>
        ${texto('Luz - tipo', 'Luz', e?.luz?.tipo)}
        ${texto('Sustrato', 'Sustrato', e?.sustrato)}
        ${texto('Fertilizante - tipo', 'Abono', e?.nutrir?.tipo)}
        ${texto('Toxicidad mascotas', 'Toxicidad para mascotas', e?.toxicidad)}
        <label>Notas agronómicas<textarea name="Notas agronómicas" rows="2">${h(p['Notas agronómicas'] || '')}</textarea></label>
      </details>
      <button class="btn grande" type="submit">Guardar</button>
    </form>`, 'home', { titulo: 'Editar ' + h(p.nombre), volver: true });
}

function leerFormulario(form) {
  const campos = {};
  new FormData(form).forEach((v, k) => { campos[k] = typeof v === 'string' ? v.trim() : v; });
  const errores = [];
  if (!campos['Nombre Casa']) errores.push('Falta el nombre.');
  GRUPOS_FREQ.forEach(([clave, titulo]) => {
    const c = C.COLS[clave];
    if (!(c.min in campos)) return;
    const a = Number(campos[c.min]), b = Number(campos[c.max]);
    if (a > 0 && b > 0 && a > b) errores.push(`${titulo}: el mínimo no puede ser mayor que el máximo.`);
    if ((a > 0 || b > 0) && !campos[c.unidad]) errores.push(`${titulo}: falta la unidad.`);
  });
  if (campos['Cumpleaños']) campos['Cumpleaños'] = new Date(campos['Cumpleaños'] + 'T12:00:00').toISOString();
  return { campos, errores };
}

// ---------------------------------------------------------------
// Calendario, archivadas, aprender, ajustes
// ---------------------------------------------------------------
function vistaCalendario() {
  const { activas } = datos();
  const grupos = { hoy: [], semana: [], luego: [] };
  activas.forEach((p) => {
    const r = p.estado.riego;
    const d = r.sinReferencia ? -1 : r.diasRestantes;
    (d <= 0 ? grupos.hoy : d <= 7 ? grupos.semana : grupos.luego).push(p);
  });
  const fil = (p) => {
    const e = p.estado;
    const otros = ['nutrir', 'trasplante'].map((t) => `<span class="nivel-${e[t].nivel}">${C.EMOJI[t]} ${e[t].reposo ? '😴' : e[t].sinReferencia ? '?' : e[t].diasRestantes <= 0 ? 'ya' : e[t].diasRestantes + ' d'}</span>`).join(' ');
    return `<li data-act="abrir" data-id="${h(p.id)}"><div><b>${h(p.nombre)}</b><div class="sub">${otros}</div></div>
      <div class="cal-der nivel-${e.riego.nivel}">${e.riego.proxima ? fecha(e.riego.proxima, { weekday: 'short', day: 'numeric' }) : '—'}<small>${C.textoEstado(e.riego)}</small></div></li>`;
  };
  const orden = (a, b) => (a.estado.riego.diasRestantes ?? -999) - (b.estado.riego.diasRestantes ?? -999);
  const bloque = (t, l) => l.length ? `<h3 class="cal-grupo">${t}</h3><ul class="lista">${l.sort(orden).map(fil).join('')}</ul>` : '';
  return marco(`
    ${bloque('💧 Hoy o atrasadas', grupos.hoy)}
    ${bloque('📆 Esta semana', grupos.semana)}
    ${bloque('🌤 Más adelante', grupos.luego)}
    ${activas.length ? '' : '<p class="vacio">Sin plantas.</p>'}
    <p class="nota centro"><a href="#/archivadas">📦 Ver plantas archivadas</a></p>`, 'cal', { titulo: 'Calendario' });
}

function vistaArchivadas() {
  const { archivadas } = datos();
  const ic = { muerta: '💀', donada: '🎁' };
  return marco(`<ul class="lista">${archivadas.map((p) => `
    <li data-act="abrir" data-id="${h(p.id)}"><div><b>${h(p.nombre)}</b><div class="sub">${ic[p.MotivoArchivado] || '📦'} ${h(p.MotivoArchivado || '')} · ${fecha(p.FechaArchivado, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
    <button class="btn peq claro" data-act="restaurar" data-id="${h(p.id)}">Restaurar</button></li>`).join('') || '<p class="vacio">No hay plantas archivadas.</p>'}</ul>`,
  'cal', { titulo: 'Archivadas', volver: true });
}

function vistaAprender() {
  const { activas } = datos();
  const consejo = A.consejoTemporada();
  const mias = new Map();
  activas.forEach((p) => { if (p.especie) mias.set(p.especie.id, [...(mias.get(p.especie.id) || []), p.nombre]); });
  const tarjetaEsp = (e) => `<li data-act="ir" data-ruta="#/especie/${h(e.id)}"><div><b>${h(e.nombres[0])}</b><div class="sub"><i>${h(e.cientifico)}</i>${mias.has(e.id) ? ` · en casa: ${h(mias.get(e.id).join(', '))}` : ''}</div></div><span>›</span></li>`;
  const enCasa = A.listaEspecies().filter((e) => mias.has(e.id));
  const otras = A.listaEspecies().filter((e) => !mias.has(e.id));
  return marco(`
    <div class="consejo"><div><b>${consejo.emoji} ${consejo.nombre}.</b> ${h(consejo.texto)}</div></div>
    ${enCasa.length ? `<h3 class="cal-grupo">Tus especies</h3><ul class="lista">${enCasa.map(tarjetaEsp).join('')}</ul>` : ''}
    ${otras.length ? `<h3 class="cal-grupo">Otras del catálogo</h3><ul class="lista">${otras.map(tarjetaEsp).join('')}</ul>` : ''}
    <h3 class="cal-grupo">Glosario</h3>
    <div class="glosario">${A.GLOSARIO.map(([t, d]) => `<details><summary>${h(t)}</summary><p>${h(d)}</p></details>`).join('')}</div>
  `, 'aprender', { titulo: 'Aprender' });
}

function vistaEspecie(id) {
  const e = A.especiePorId(id);
  if (!e) return vistaAprender();
  const r = (x) => C.textoRango(x) || '—';
  return marco(`
    ${bloqueEspecie(e)}
    <div class="tarjeta-bloque">
      <h3>Ficha rápida</h3>
      ${fila('💧 Prim–verano', r(e.riego?.cv))}${fila('💧 Oto–invierno', r(e.riego?.oi))}
      ${fila('Cantidad', e.riego?.cantidad)}${fila('Método', e.riego?.metodo)}
      ${fila('🌿 Nutrir', [e.nutrir?.cuando, e.nutrir?.tipo].filter(Boolean).join('. '))}
      ${fila('🪴 Trasplante', [r(e.trasplante), e.trasplante?.nota].filter(Boolean).join('. '))}
      ${fila('☀️ Luz', [e.luz?.tipo, e.luz?.exposicion, e.luz?.horas].filter(Boolean).join(' · '))}
      ${fila('Sustrato', e.sustrato)}${fila('🌡 Temperatura', e.temperatura)}
      ${e.toxicidad ? `<div class="dato ${e.toxica ? 'aviso' : ''}"><span>Mascotas</span><div>${h(e.toxicidad)}</div></div>` : ''}
    </div>`, 'aprender', { titulo: h(e.nombres?.[0] || e.cientifico), volver: true });
}

function vistaAjustes() {
  const c = S.conf() || {};
  const s = S.infoSync();
  const personas = S.vista().personas || [];
  return marco(`
    <div class="tarjeta-bloque">
      <h3>¿Quién eres?</h3>
      <div class="chips">${personas.map((n) => `<button class="chip ${n === S.persona() ? 'on' : ''}" data-act="persona" data-nombre="${h(n)}">${h(n)}</button>`).join('')}
      <button class="chip" data-act="quien">+ Otra persona</button></div>
    </div>
    <div class="tarjeta-bloque">
      <h3>Sincronización</h3>
      ${S.esDemo() ? '<p>Estás en <b>modo prueba</b>: los datos solo viven en este móvil.</p>' : `
        <p>${{ ok: '✅ Al día', enviando: '⏳ Guardando…', error: '⚠️ Error: ' + h(s.error || ''), offline: '📴 Sin red' }[s.estado]}
        ${s.pendientes ? ` · ${s.pendientes} cambios por enviar` : ''}</p>
        <p class="nota">Última vez: ${s.ultima ? new Date(s.ultima).toLocaleString('es-ES') : 'nunca'}</p>
        <button class="btn peq" data-act="sync">Sincronizar ahora</button>`}
    </div>
    <div class="tarjeta-bloque">
      <h3>Conexión con tu hoja</h3>
      <form id="form-conexion" class="formulario">
        <label>URL de la API (Apps Script /exec)<input name="api" type="url" value="${h(c.api || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label>Clave de acceso<input name="k" type="password" value="${h(c.k || '')}" autocomplete="off"></label>
        <button class="btn peq" type="submit">Conectar</button>
      </form>
      ${c.api ? `<button class="btn peq claro" data-act="compartir">🔗 Copiar enlace para otra persona</button>` : ''}
    </div>
    ${S.esDemo() || !c.api ? '' : `<div class="tarjeta-bloque">
      <h3>🔔 Avisos de riego</h3>
      ${bloqueAvisos()}
    </div>`}
    <div class="tarjeta-bloque">
      <h3>Datos</h3>
      ${S.fotosSinSubir() ? `<p class="nota">⏳ ${S.fotosSinSubir()} fotos esperando red para subirse.</p>` : ''}
      <button class="btn peq claro" data-act="exportar">⬇️ Descargar copia (JSON)</button>
      ${S.esDemo() ? '' : '<button class="btn peq claro" data-act="demo">🧪 Probar con datos de ejemplo</button>'}
    </div>
    <div class="tarjeta-bloque">
      <h3>Instalar en el móvil</h3>
      ${instalable ? '<button class="btn peq" data-act="instalar">📲 Instalar Planteate</button>' : ''}
      ${matchMedia('(display-mode: standalone)').matches ? '<p>✅ Estás usando la app instalada.</p>' : ''}
      <p><b>Android (Chrome):</b> menú ⋮ → <i>Instalar aplicación</i>. Si dice que ya está instalada pero no la ves, busca "Planteate" en el cajón de apps o en Ajustes → Aplicaciones; si solo hay un acceso directo, bórralo y vuelve a instalar.<br><b>iPhone (Safari):</b> compartir → <i>Añadir a pantalla de inicio</i>.</p>
    </div>
    <p class="nota centro">Planteate ${VERSION}</p>`, 'ajustes', { titulo: 'Ajustes' });
}

/** Avisos de riego con notificaciones de la propia app. */
function bloqueAvisos() {
  const p = Av.permiso();
  if (p === 'no') return '<p class="nota">Este navegador no permite notificaciones.</p>';
  if (p === 'denied') return '<p class="nota">Las notificaciones están bloqueadas. Actívalas en Ajustes del móvil → Aplicaciones → Chrome (o Planteate) → Notificaciones.</p>';
  if (p !== 'granted') return '<p>Te avisaremos cuando toque regar.</p><button class="btn peq" data-act="activar-avisos">🔔 Activar avisos</button>';
  return `<p>Avisos <b>activados ✅</b>: una vez al día, a partir de las 9:00, si alguna planta necesita agua.</p>
    <button class="btn peq claro" data-act="probar-aviso">📨 Probar aviso</button>
    <p class="nota">Funcionan mejor con la app instalada. Si el móvil corta las apps en segundo plano (ColorOS lo hace), el aviso llegará al abrir Planteate.</p>`;
}

function vistaBienvenida() {
  return `<main class="contenido bienvenida">
    <div class="vacio-ic">🌿</div>
    <h1>Planteate</h1>
    <p>Cuida tus plantas y aprende de ellas.</p>
    <form id="form-conexion" class="formulario">
      <label>URL de la API<input name="api" type="url" required placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label>Clave de acceso<input name="k" type="password" required autocomplete="off"></label>
      <button class="btn grande" type="submit">Conectar con mi hoja</button>
    </form>
    <p class="nota">¿Te han pasado un enlace? Ábrelo y se conecta solo.</p>
    <button class="btn claro" data-act="demo">🧪 Probar con datos de ejemplo</button>
  </main>`;
}

// ---------------------------------------------------------------
// Modales
// ---------------------------------------------------------------
function modalQuien() {
  const personas = S.vista().personas || [];
  modal(`<h2>¿Quién eres?</h2><p class="nota">Así sabremos quién cuida cada planta.</p>
    <div class="chips">${personas.map((n) => `<button class="chip" data-act="persona" data-nombre="${h(n)}">${h(n)}</button>`).join('')}</div>
    <form id="form-quien" class="formulario"><input name="nombre" placeholder="Tu nombre" maxlength="40" required><button class="btn" type="submit">Soy yo</button></form>`, { cerrable: !!S.persona() });
}

function modalPosponer(id) {
  modal(`<h2>⏳ Sigue húmeda</h2><p>No hace falta regar todavía. ¿Cuándo vuelvo a avisar?</p>
    <div class="chips">${[1, 2, 3, 4, 5, 7].map((d) => `<button class="chip" data-act="posponer-dias" data-id="${h(id)}" data-dias="${d}">${d} ${d === 1 ? 'día' : 'días'}</button>`).join('')}</div>
    <p class="nota">💡 Comprobar la tierra antes de regar es el mejor hábito. Así aprendes el ritmo real de cada planta.</p>`);
}

function modalObservar(id) {
  const rapidas = ['🌱 Hoja nueva', '🌸 Flor', '🟡 Hojas amarillas', '🟤 Puntas secas', '🐛 Plaga', '💧 Tierra encharcada', '🥀 Decaída'];
  modal(`<h2>📝 Observación</h2>
    <div class="chips">${rapidas.map((r) => `<button class="chip" data-act="obs-rapida" data-texto="${h(r)}">${r}</button>`).join('')}</div>
    <form id="form-observar" class="formulario" data-id="${h(id)}"><textarea name="detalle" rows="3" placeholder="¿Qué has visto?" required></textarea><button class="btn" type="submit">Guardar</button></form>`);
}

/** Lo que sabemos de una planta, para Gemini y el diagnóstico. */
function contextoPlanta(id) {
  const { v, plantas } = datos();
  const p = plantas.find((x) => x.id === id);
  const e = p.especie;
  const r = p.estado.riego;
  const obs = v.acciones.filter((a) => a.plantaId === id && ['observacion', 'diagnostico'].includes(a.tipoAccion))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 5).map((a) => `${fecha(a.timestamp)}: ${a.detalle}`);
  return {
    nombrePlanta: p.nombre,
    especie: e ? `${e.nombres?.[0] || ''} (${e.cientifico})` : (p['Nombre científico'] || 'desconocida'),
    estacion: C.estacion().nombre,
    ubicacion: p['Ubicación'] || null,
    riego: { nivel: r.nivel, diasDesde: r.diasDesde, freqDias: r.freq.dias, sinReferencia: r.sinReferencia, frecuencia: C.textoFrecuencia(r.freq) },
    nutrir: p.estado.nutrir.diasDesde,
    cuidadosEspecie: e ? { luz: e.luz, sustrato: e.sustrato, temperatura: e.temperatura, comoSaber: e.riego?.comoSaber } : null,
    ultimasObservaciones: obs,
    notas: p.NotaPersonal || null
  };
}

function modalPreguntar(id) {
  const rapidas = ['¿Por qué se le ponen amarillas las hojas?', '¿Dónde la pongo en casa?', '¿Cómo la reproduzco?', '¿Es normal que crezca tan lento?'];
  modal(`<h2>💬 Pregúntale</h2>
    <p class="nota">Responde una IA que conoce su especie y su historial. Es orientativo.</p>
    <div class="chips">${rapidas.map((r) => `<button class="chip" data-act="pregunta-rapida" data-texto="${h(r)}">${h(r)}</button>`).join('')}</div>
    <form id="form-preguntar" class="formulario" data-id="${h(id)}"><textarea name="pregunta" rows="3" maxlength="500" placeholder="Escribe tu pregunta…" required></textarea><button class="btn" type="submit">Preguntar</button></form>
    <div id="respuesta"></div>`);
}

function modalArchivar(id) {
  modal(`<h2>📦 Archivar planta</h2><p>Se guarda todo su historial. Puedes restaurarla cuando quieras.</p>
    <div class="chips"><button class="chip" data-act="archivar-motivo" data-id="${h(id)}" data-motivo="muerta">💀 Murió</button>
    <button class="chip" data-act="archivar-motivo" data-id="${h(id)}" data-motivo="donada">🎁 La regalé</button>
    <button class="chip" data-act="archivar-motivo" data-id="${h(id)}" data-motivo="otro">📦 Otro</button></div>`);
}

// ---------------------------------------------------------------
// Acciones (data-act)
// ---------------------------------------------------------------
const acciones = {
  ir: (el) => ir(el.dataset.ruta),
  volver: () => (history.length > 1 ? history.back() : ir('#/')),
  abrir: (el) => { ui.tab = 'cuidar'; ir('#/p/' + el.dataset.id); },
  sync: () => S.sincronizar(),
  filtro: (el) => { ui.filtro = ui.filtro === el.dataset.tipo ? null : el.dataset.tipo; pintar(); },
  'ocultar-consejo': () => { localStorage.setItem('pl5_consejo_visto', A.consejoTemporada().id + new Date().getFullYear()); pintar(); },
  seleccion: () => { ui.seleccion = ui.seleccion ? null : new Set(); pintar(); },
  marcar: (el) => { const s = ui.seleccion; s.has(el.dataset.id) ? s.delete(el.dataset.id) : s.add(el.dataset.id); pintar(); },
  'accion-masiva': (el) => {
    const ids = [...ui.seleccion];
    ui.seleccion = null;
    const logIds = S.registrarAccion(ids, el.dataset.tipo);
    toast(`${C.EMOJI[el.dataset.tipo]} ${C.VERBO[el.dataset.tipo]}: ${ids.length} plantas`, { deshacer: logIds });
  },
  'marcar-grupo': (el) => { el.dataset.ids.split(',').forEach((id) => ui.seleccion.add(id)); pintar(); },
  agrupar: () => { ui.agrupar = !ui.agrupar; localStorage.setItem('pl5_agrupar', ui.agrupar ? '1' : '0'); pintar(); },
  cuidar: (el) => {
    const { plantas } = datos();
    const p = plantas.find((x) => x.id === el.dataset.id);
    const tipo = el.dataset.tipo;
    const logIds = S.registrarAccion(p.id, tipo);
    if (tipo === 'riego' && p.RiegoPospuestoHasta) S.guardarPlanta(p.id, { RiegoPospuestoHasta: '' });
    toast(`${C.EMOJI[tipo]} ${p.nombre}: ${C.ETIQUETA[tipo].toLowerCase()} anotado`, { pista: A.pistaTras(tipo, p.especie), deshacer: logIds });
  },
  deshacer: () => {
    if (!ui.deshacer) return;
    S.deshacer(ui.deshacer);
    ui.deshacer = null;
    toast('↩️ Deshecho');
  },
  posponer: (el) => modalPosponer(el.dataset.id),
  'posponer-dias': (el) => {
    const hasta = new Date(); hasta.setDate(hasta.getDate() + Number(el.dataset.dias));
    S.guardarPlanta(el.dataset.id, { RiegoPospuestoHasta: hasta.toISOString() });
    cerrarModal();
    toast(`⏳ Aviso aplazado ${el.dataset.dias} días`);
  },
  observar: (el) => modalObservar(el.dataset.id),
  'obs-rapida': (el) => { const t = document.querySelector('#form-observar textarea'); t.value = (t.value ? t.value + ' · ' : '') + el.dataset.texto; t.focus(); },
  archivar: (el) => modalArchivar(el.dataset.id),
  'archivar-motivo': (el) => {
    S.guardarPlanta(el.dataset.id, { Archivada: 'TRUE', MotivoArchivado: el.dataset.motivo, FechaArchivado: new Date().toISOString() });
    cerrarModal(); toast('📦 Planta archivada'); ir('#/');
  },
  restaurar: (el) => { S.guardarPlanta(el.dataset.id, { Archivada: 'FALSE' }); toast('↩️ Planta restaurada'); },
  'guardar-nota': (el) => { S.guardarPlanta(el.dataset.id, { NotaPersonal: document.getElementById('nota').value.trim() }); toast('📝 Nota guardada'); },
  'asignar-especie': (el) => {
    const id = document.getElementById('elegir-especie').value;
    const e = A.especiePorId(id);
    if (!e) return;
    S.guardarPlanta(el.dataset.id, { especieId: id, 'Nombre científico': e.cientifico, Familia: e.familia || '' });
  },
  'crear-ficha': async (el) => {
    el.disabled = true;
    el.textContent = '✨ Creando ficha… (unos segundos)';
    try {
      const e = await S.fichaEspecie(el.dataset.nombre);
      S.guardarPlanta(el.dataset.id, { especieId: e.id });
      toast(`✨ Ficha de ${e.nombres?.[0] || e.cientifico} creada. Revísala: es orientativa.`);
    } catch (e) {
      toast('No se pudo crear la ficha: ' + e.message);
      pintar();
    }
  },
  preguntar: (el) => modalPreguntar(el.dataset.id),
  'pregunta-rapida': (el) => { const t = document.querySelector('#form-preguntar textarea'); t.value = el.dataset.texto; t.focus(); },
  tab: (el) => {
    ui.tab = el.dataset.tab;
    pintar();
    if (el.dataset.scroll) document.getElementById('tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  grafico: (el) => { ui.grafico = el.dataset.tipo; pintar(); },
  'foto-grande': (el) => {
    const f = fotosIndex.get(el.dataset.fotoId);
    if (!f) return;
    modal(`${imgFoto(f, 'class="foto-grande"')}<button class="btn claro" data-act="cerrar">Cerrar</button>`);
    cargarFotos();
  },
  comparar: (el) => { ui.comparar = ui.comparar?.id === el.dataset.id ? null : { id: el.dataset.id }; pintar(); },
  cerrar: () => cerrarModal(),
  'subir-foto': async (el) => {
    const file = await pedirFoto();
    if (!file) return;
    try {
      const f = await comprimirFoto(file);
      await S.subirFoto(el.dataset.id, f.base64, f.mime);
      toast(navigator.onLine || S.esDemo() ? '📷 Foto guardada' : '📷 Foto guardada en el móvil. Se subirá cuando haya red.');
    } catch (e) { toast('No se pudo guardar la foto: ' + e.message); }
  },
  'borrar-foto': async (el) => {
    if (!confirm('¿Borrar esta foto?')) return;
    try { await S.eliminarFoto(el.dataset.fotoBorrar); } catch (e) { toast('No se pudo borrar: ' + e.message); }
  },
  'probar-aviso': async (el) => {
    el.disabled = true;
    try { await Av.probar(); } catch (e) { toast('No se pudo enviar: ' + e.message); }
    el.disabled = false;
  },
  'activar-avisos': async () => {
    try { await Av.activar(); toast('🔔 Avisos activados'); Av.guardar(datos().plantas); } catch (e) { toast(e.message); }
    pintar();
  },
  instalar: async () => {
    if (!instalable) return;
    instalable.prompt();
    await instalable.userChoice;
    instalable = null; pintar();
  },
  diagnosticar: async (el) => {
    const id = el.dataset.id;
    const file = await pedirFoto();
    if (!file) return;
    ui.diagnostico = { id, cargando: true }; pintar();
    try {
      const f = await comprimirFoto(file);
      const r = await S.diagnosticar(id, f.base64, f.mime, contextoPlanta(id));
      ui.diagnostico = { id, html: r.ok ? `<h3>🩺 Diagnóstico</h3>${r.diagnostico.resumen.map((l) => `<p>${h(l)}</p>`).join('')}<p class="nota">Orientativo. Ante dudas, un vivero de confianza.</p>` : `<p>${h(r.motivo)}</p>` };
    } catch (e) { ui.diagnostico = { id, html: `<p>No se pudo analizar: ${h(e.message)}</p>` }; }
    pintar();
  },
  identificar: async () => {
    const file = await pedirFoto();
    if (!file) return;
    const form = document.getElementById('form-nueva');
    ui.borrador = Object.fromEntries(new FormData(form));
    ui.candidatos = '<p class="nota">🔎 Identificando…</p>'; pintar();
    try {
      const f = await comprimirFoto(file);
      ui.fotoAlta = f;
      const r = await S.identificar(f.base64, f.mime);
      ui.ultimosCandidatos = r.ok ? r.candidatos : [];
      ui.candidatos = r.ok
        ? `<div class="candidatos">${r.candidatos.slice(0, 3).map((c, i) => `<button type="button" class="candidato" data-act="elegir-candidato" data-i="${i}"><b>${h(c.nombreCientifico)}</b><span>${h(c.nombreComunSugerido || '')}${c.confianza == null ? '' : ` · ${Math.round(c.confianza * 100)}%`}</span></button>`).join('')}</div>`
        : `<p class="nota">${h(r.motivo)}</p>`;
    } catch (e) { ui.candidatos = `<p class="nota">No se pudo identificar: ${h(e.message)}</p>`; }
    pintar();
  },
  'elegir-candidato': (el) => {
    const c = ui.ultimosCandidatos[Number(el.dataset.i)];
    const e = A.especieDe({ 'Nombre científico': c.nombreCientifico });
    ui.borrador = { ...ui.borrador, 'Nombre científico': c.nombreCientifico, especieId: e?.id || '', 'Nombre Casa': ui.borrador?.['Nombre Casa'] || c.nombreComunSugerido || '', _identificacion: c };
    ui.candidatos = `<p class="nota">✅ ${h(c.nombreCientifico)}${e ? ` — la conozco: ${h(e.nombres[0])}` : ' — no está en el catálogo; usaremos cuidados por defecto'}.</p>`;
    pintar();
  },
  persona: (el) => { S.elegirPersona(el.dataset.nombre); cerrarModal(); pintar(); },
  quien: () => modalQuien(),
  demo: () => { if (S.conf() && !S.esDemo() && !confirm('¿Pasar a modo prueba? Tendrás que volver a conectar después.')) return; S.configurar({ demo: true }); ir('#/'); },
  exportar: () => {
    const blob = new Blob([S.exportar()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planteate-copia-${hoyIso()}.json`;
    a.click();
  },
  compartir: async () => {
    const c = S.conf();
    const url = `${location.origin}${location.pathname}#/conectar?api=${encodeURIComponent(c.api)}&k=${encodeURIComponent(c.k)}`;
    try { await navigator.clipboard.writeText(url); toast('🔗 Enlace copiado. Envíalo solo a gente de casa.'); }
    catch { prompt('Copia este enlace:', url); }
  }
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !acciones[el.dataset.act]) return;
  ev.preventDefault();
  acciones[el.dataset.act](el, ev);
});

document.addEventListener('change', (ev) => {
  const cambio = ev.target.dataset?.cambio;
  if (cambio === 'comparar-a' || cambio === 'comparar-b') {
    ui.comparar = { ...ui.comparar, [cambio.slice(-1)]: ev.target.value };
    ev.target.blur();
    pintar();
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  if (form.id === 'form-preguntar') {
    const caja = document.getElementById('respuesta');
    const boton = form.querySelector('button');
    boton.disabled = true;
    caja.innerHTML = '<p class="nota">Pensando…</p>';
    S.preguntar(form.pregunta.value.trim(), contextoPlanta(form.dataset.id))
      .then((r) => { caja.innerHTML = `<div class="respuesta">${h(r).replace(/\n/g, '<br>')}</div>`; })
      .catch((e) => { caja.innerHTML = `<p class="nota">No se pudo responder: ${h(e.message)}</p>`; })
      .finally(() => { boton.disabled = false; });
    return;
  }
  if (form.id === 'form-quien') { S.elegirPersona(form.nombre.value); cerrarModal(); pintar(); }
  else if (form.id === 'form-observar') {
    const detalle = form.detalle.value.trim();
    cerrarModal();
    S.registrarAccion(form.dataset.id, 'observacion', detalle);
    toast('📝 Observación guardada', { pista: A.pistaTras('observacion') });
  } else if (form.id === 'form-conexion') {
    const api = form.api.value.trim(), k = form.k.value.trim();
    if (!api || !k) return;
    if (!urlApiValida(api)) return toast('La URL debe ser la de tu Apps Script: https://script.google.com/macros/s/…/exec');
    S.configurar({ api, k });
    ir('#/'); pintar();
    S.sincronizar().then(() => { const s = S.infoSync(); toast(s.estado === 'ok' ? '✅ Conectado' : '⚠️ ' + (s.error || 'No se pudo conectar')); });
  } else if (form.id === 'form-nueva') {
    const { campos, errores } = leerFormulario(form);
    if (errores.length) return toast(errores.join(' '));
    const e = A.especiePorId(campos.especieId);
    if (e) { campos['Nombre científico'] ||= e.cientifico; campos.Familia = e.familia; }
    const id = S.crearPlanta(campos);
    const ident = ui.borrador?._identificacion;
    if (ident) S.registrarAccion(id, 'identificacion', `${ident.nombreCientifico} (${Math.round((ident.confianza || 0) * 100)}%)`);
    const foto = ui.fotoAlta;
    ui.borrador = ui.candidatos = ui.fotoAlta = null;
    ui.tab = 'cuidar';
    location.replace('#/p/' + id);
    toast(`🌱 ${campos['Nombre Casa']} ya está en casa`);
    if (foto) S.sincronizar().then(() => S.subirFoto(id, foto.base64, foto.mime)).catch(() => toast('La foto no se pudo subir; añádela luego.'));
  } else if (form.id === 'form-editar') {
    const { campos, errores } = leerFormulario(form);
    if (errores.length) return toast(errores.join(' '));
    S.guardarPlanta(form.dataset.id, campos);
    toast('✅ Ficha guardada');
    history.back();
  }
});

// ---------------------------------------------------------------
// Router y pintado
// ---------------------------------------------------------------
function ruta() {
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  return { partes: path.split('/').filter(Boolean), query: new URLSearchParams(query || '') };
}

let ultimaRuta = null;
export function pintar() {
  const { partes, query } = ruta();

  if (partes[0] === 'conectar' && query.get('api') && query.get('k')) {
    // Limpiar el hash ANTES de configurar: configurar() repinta y, si el hash
    // siguiera siendo #/conectar, volvería a entrar aquí sin fin.
    history.replaceState(null, '', location.pathname + '#/');
    const nueva = { api: query.get('api').trim(), k: query.get('k').trim() };
    const actual = S.conf();
    if (!urlApiValida(nueva.api)) {
      toast('⚠️ Enlace no válido: no apunta a un Apps Script. No se ha cambiado nada.');
    } else if (actual?.api === nueva.api && actual?.k === nueva.k) {
      // Mismo enlace: nada que hacer.
    } else if (!actual?.api || actual.demo || confirm('Este enlace cambia la hoja a la que está conectada la app. ¿Seguro? Ábrelo solo si te lo ha mandado alguien de casa.')) {
      S.configurar(nueva);
      S.sincronizar();
    }
    return pintar();
  }
  if (!S.conf()) { app.innerHTML = vistaBienvenida(); return; }
  if (!S.tieneDatos()) {
    const s = S.infoSync();
    app.innerHTML = `<main class="contenido bienvenida"><div class="brote"></div><p>${s.estado === 'error' ? '⚠️ ' + h(s.error) : 'Abriendo el invernadero…'}</p>
      ${s.estado === 'error' ? '<button class="btn" data-act="sync">Reintentar</button> <button class="btn claro" data-act="ir" data-ruta="#/ajustes">Ajustes</button>' : ''}</main>`;
    if (s.estado !== 'error' && s.estado !== 'enviando') S.sincronizar();
    if (partes[0] === 'ajustes') app.innerHTML = vistaAjustes();
    return;
  }

  const clave = partes.join('/');
  if (clave !== ultimaRuta) { if (!/^p\/[^/]+$/.test(clave) || !ultimaRuta?.startsWith(clave)) window.scrollTo(0, 0); ultimaRuta = clave; }

  const [a, b, c] = partes;
  app.innerHTML =
    !a ? vistaHome()
    : a === 'p' && c === 'editar' ? vistaEditar(b)
    : a === 'p' ? vistaDetalle(b)
    : a === 'nueva' ? vistaNueva()
    : a === 'calendario' ? vistaCalendario()
    : a === 'archivadas' ? vistaArchivadas()
    : a === 'aprender' ? vistaAprender()
    : a === 'especie' ? vistaEspecie(b)
    : a === 'ajustes' ? vistaAjustes()
    : vistaHome();

  cargarFotos();
  programarAvisos();
  if (!S.persona() && !document.querySelector('.modal-fondo')) modalQuien();
}

// No repintar mientras se escribe (se perdería el texto). Se repinta al salir.
let pendiente = false;
const escribiendo = () => {
  const el = document.activeElement;
  return (el && app.contains(el) && el.matches('input,textarea,select')) || !!document.querySelector('#form-nueva, #form-editar');
};
S.suscribir(() => {
  if (escribiendo()) {
    pendiente = true;
    document.querySelectorAll('.sync').forEach((el) => { el.outerHTML = indicadorSync(); });
    return;
  }
  pintar();
});
document.addEventListener('focusout', () => setTimeout(() => { if (pendiente && !escribiendo()) { pendiente = false; pintar(); } }, 50));
window.addEventListener('hashchange', () => { cerrarModal(); pintar(); });

// ---------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------
A.cargarEspecies().catch((e) => console.warn('Catálogo:', e)).finally(() => {
  pintar();
  if (S.conf() && !S.esDemo()) S.sincronizar();
});

// Botón "Instalar" propio: Chrome avisa cuando la app se puede instalar.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); instalable = e; if (location.hash.startsWith('#/ajustes')) pintar(); });

// Avisos de riego: tras cada cambio, guardar las fechas para el service worker.
let temporizadorAvisos = null;
function programarAvisos() {
  if (!S.conf() || S.esDemo() || Av.permiso() !== 'granted') return;
  clearTimeout(temporizadorAvisos);
  temporizadorAvisos = setTimeout(() => { try { Av.guardar(datos().plantas); } catch (e) { console.warn('Avisos:', e); } }, 2000);
}

if ('serviceWorker' in navigator) {
  // Al publicar una versión nueva, el SW nuevo toma el control: recargar una vez para usarla.
  const habiaVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (habiaVersion) location.reload(); });
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch((e) => console.warn('SW:', e));
}
