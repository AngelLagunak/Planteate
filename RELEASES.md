# Planteate — Historial de versiones

Este documento se actualiza en cada entrega con un resumen de qué cambió.
Para entender cómo funciona la app hoy, consulta `README.md` (el
manual); este archivo es solo el histórico.

---

## V5.0 — PWA

**Plataforma**
- Nueva app web instalable (PWA) para GitHub Pages: abre al instante,
  funciona sin red y se instala con icono propio.
- Apps Script pasa a ser solo una API JSON (`Api.gs`, se añade al
  proyecto V4 sin tocar nada). Un token compartido protege el acceso.
- Datos locales + cola offline: las acciones se ven al momento y se
  envían en lote. Sin polling cada 25 s.
- Reglas de estado portadas al móvil (`js/cuidados.js`).

**Modelo**
- Catálogo `data/especies.json` (11 especies, del CSV del piso). La
  planta usa la frecuencia de su especie si no tiene una propia.
- Abono + fertilizante → **Nutrir**. En reposo de septiembre a febrero.
- Columnas nuevas (se crean solas): `especieId`, `Ubicación`.

**Aprender**
- "¿Por qué?" en cada estado, pista tras cada acción, pestaña Conócela
  (origen, por qué se cuida así, errores, trucos, curiosidad, Wikipedia),
  comentario sobre tu historial real, consejo de temporada, glosario,
  observaciones 📝 en la línea de tiempo.

**Quitado**: Plant.id y Perenual dejan de ser necesarios (siguen en el
backend V4, pero la PWA no depende de ellos).

---

## V4.1 — ajuste

- **Personas (causa real):** en la hoja "Personas" faltaba la fila de
  cabeceras (`nombre | fechaAlta`), así que la primera persona se leía como
  cabecera, la lista salía vacía y no se detectaban duplicados.
  `Personas.gs` ahora repara la cabecera automáticamente (sin perder datos)
  y elimina repetidos al listar. Solo cambia `Personas.gs`.

---

## V4.0 — completa (tandas 1 y 2)

**Estructura de datos**
- Frecuencias de riego (prim/verano y oto/invierno), abono, fertilizante y
  trasplante pasan a **intervalo mínimo + intervalo máximo + unidad**. El
  texto legado se genera solo y sigue valiendo como respaldo. Validación:
  mín ≤ máx. (`Cuidados.gs`, `Validacion.gs`, `App.html`)
- Migración opcional `migrarFrecuenciasARangos_` con wrapper
  `EJECUTAR_migrarFrecuenciasARangos` (`Migracion.gs`).
- Plantilla `Plantitas piso - Datos (plantilla V4.0).xlsx` con la nueva
  estructura (referencia; la hoja real se actualiza con la migración).

**Correcciones**
- "Riego atrasado (undefinedd)": causa real = `google.script.run` convierte
  `null` en `undefined`. Ahora el servidor envía `sinReferencia` (booleano)
  y el cliente muestra "⚠️ Sin fecha de referencia — revisar ficha".
  Ajustado también en `Diagnostico.gs`. Las plantas nuevas ya inician sus
  frecuencias al crearse.
- Personas: si escribes un nombre ya existente se reutiliza (sin volver a
  registrarlo); si la lista falla al cargar se avisa con "Reintentar" en vez
  de quedar en blanco.
- Cumpleaños: prellenado con la fecha de hoy al crear planta (editable).
- Ortografía: "Calendario de cuidados", "Plantas archivadas", "Nueva
  planta", "Gestor de plantas".

**Novedades**
- 📊 Gráfico de frecuencia en la ficha: intervalos reales entre registros
  vs. frecuencia objetivo, con pestañas riego/abono/fertilizante/
  trasplante. `getPlanta` devuelve `historialCuidados` (`Plantas.gs`,
  `Cuidados.gs`).
- `ARQUITECTURA.md` reescrito como manual de uso y funcionamiento.

**Archivos modificados en V4.0**: App.html, Cuidados.gs, Plantas.gs,
Validacion.gs, Main.gs, Migracion.gs, Diagnostico.gs. El resto solo sube
la cabecera de versión.

---

## V3.0 (entregas previas, resumen)

- Modelo de datos consolidado: una sola hoja "Plantas" (activas y
  archivadas juntas) y una sola hoja "Acciones" (historial único de
  riego/abono/fertilizante/trasplante + eventos de identificación y
  diagnóstico).
- Frecuencias estructuradas (intervalo único + unidad) con fallback a
  texto libre.
- Mismo criterio de estación (mes natural) en toda la app.
- Estado "rojo explícito" cuando no hay fecha de referencia de cuidado.
- Caché corta de listados (20s) y sincronización automática con
  descarte de respuestas desactualizadas.
- Selección múltiple y acciones masivas en la portada.
- Identificación por foto (Pl@ntNet/Plant.id) y diagnóstico de salud
  (Pl@ntNet/Plant.id + contexto de cuidados + Gemini opcional).
- Refactor de modales del cliente (`crearModal_`/`cerrarModal_`).
- Seguridad: `XFrameOptions.DEFAULT`, mensajes de error sin exponer
  claves de API.