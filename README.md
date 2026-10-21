# Planteate 5.0 — PWA

Gestor de plantas del hogar que además enseña. App web instalable, rápida
y sin coste: GitHub Pages sirve la app y Google Sheets sigue guardando los
datos (los mismos de la V4).

## Cómo está hecha

```
Móvil (PWA instalada)                       Google
┌──────────────────────────────┐            ┌────────────────────────────┐
│ index.html + css + js        │  1 llamada │ Apps Script (Api.gs)       │
│ cuidados.js  reglas de estado│ ─────────▶ │  doPost: todo / lote /     │
│ aprender.js  explicar/enseñar│  lote JSON │  fotos / identificar /     │
│ store.js     copia local +   │ ◀───────── │  diagnosticar              │
│              cola offline    │  estado    │ Sheets: Plantas, Acciones, │
│ data/especies.json catálogo  │  completo  │  Fotos, Personas · Drive   │
│ sw.js        abre sin red    │            └────────────────────────────┘
└──────────────────────────────┘
```

- **Local primero**: regar, posponer, editar… cambia la pantalla al
  instante y se guarda en una cola. La cola se envía en lote cuando hay
  red. Reenviar no duplica (cada acción lleva su `logId`).
- **Sin polling**: sincroniza al abrir, al volver a la app y tras escribir.
- **Especie ≠ planta**: `data/especies.json` guarda el saber de cada
  especie (riego por estación, luz, sustrato, por qué, errores, trucos…).
  La planta solo guarda lo que difiere. Si una planta no tiene frecuencia
  propia, usa la de su especie.
- **Nutrir** = abono + fertilizante. Las acciones antiguas `abono` y
  `fertilizante` cuentan como nutrir; las nuevas se guardan como `nutrir`.
  De septiembre a febrero no avisa (reposo).
- **Aprender**: "¿por qué?" en cada estado, pista tras cada acción,
  pestaña Conócela (catálogo + Wikipedia), comentarios sobre tu propio
  historial, consejo de temporada, glosario, observaciones (📝).

## Puesta en marcha (una vez)

### 1. API en Apps Script
1. Abre el proyecto de Apps Script de la V4.
2. Añade un archivo `Api` y pega `apps-script/Api.gs`. Guarda.
3. Ejecuta `crearTokenApi` (desplegable de funciones → ▶). Copia el token
   del registro de ejecución.
4. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Copia la URL que acaba en `/exec`.

La V4 sigue funcionando con su URL de siempre mientras pruebas.

### 2. Conectar la app
Abre la web de la app, pega la URL `/exec` y el token. Luego en
**Ajustes → Copiar enlace para otra persona** y mándalo a quien viva en
casa: al abrirlo se conecta solo.

### 3. Instalar en el móvil
- Android (Chrome): menú ⋮ → *Instalar aplicación*.
- iPhone (Safari): compartir → *Añadir a pantalla de inicio*.

## Desarrollo

- Probar en local: `powershell -File tools/servir.ps1` y abrir
  http://localhost:8080 (botón "Probar con datos de ejemplo").
- Al publicar cambios, **sube `VERSION` en `sw.js`** para que los móviles
  descarguen la versión nueva.
- Añadir una especie: nuevo objeto en `data/especies.json` (mismo formato).

## Columnas nuevas en la hoja

Se crean solas al usarlas: `especieId`, `Ubicación`. Nuevos `tipoAccion`
en Acciones: `nutrir`, `observacion`.

## Límites conocidos

- Fotos, identificación y diagnóstico necesitan red.
- Las fotos siguen en Drive con "cualquiera con el enlace".
- Quien tenga el enlace con token puede escribir. Compártelo solo en casa.
  Para cortar el acceso: ejecuta `crearTokenApi` otra vez y reconecta.
