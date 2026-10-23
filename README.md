# Planteate — PWA

Gestor de plantas del hogar que además enseña. App web instalable, rápida
y sin coste: GitHub Pages sirve la app y Google Sheets guarda los datos.

App: https://angellagunak.github.io/Planteate/

## Cómo está hecha

```
Móvil (PWA instalada)                       Google
┌──────────────────────────────┐            ┌────────────────────────────┐
│ index.html + css + js        │  1 llamada │ Apps Script (Planteate.gs) │
│ cuidados.js  reglas de estado│ ─────────▶ │  todo / lote / fotos /     │
│ aprender.js  explicar/enseñar│  lote JSON │  identificar / diagnosticar│
│ store.js     copia local +   │ ◀───────── │  preguntar / fichaEspecie  │
│              cola offline    │  estado    │  aviso diario 9:00         │
│ idb.js       fotos en el móvil│ completo  │ Sheets: Plantas, Acciones, │
│ data/especies.json catálogo  │            │  Fotos, Personas, Especies │
│ sw.js        abre sin red    │            │ Drive: fotos (privadas)    │
└──────────────────────────────┘            └────────────────────────────┘
                                   avisos → ntfy / Telegram / WhatsApp
```

- **Local primero**: regar, posponer, editar… cambia la pantalla al
  instante y se guarda en una cola. La cola se envía en lote cuando hay
  red. Reenviar no duplica (cada acción lleva su `logId`).
- **Deshacer**: cada acción ofrece "Deshacer" unos segundos. Si ya se
  envió, se borra de la hoja.
- **Sin polling**: sincroniza al abrir, al volver a la app y tras escribir.
- **Especie ≠ planta**: `data/especies.json` guarda el saber de cada
  especie. Las especies que no están se pueden crear con IA (Gemini) y se
  guardan en la hoja "Especies".
- **Nutrir** = abono + fertilizante. De septiembre a febrero no avisa.
- **Fotos**: privadas en Drive. La app las pide una vez y las guarda en el
  móvil. Sin red, se guardan y se suben solas al volver la conexión.
- **Aprender**: "¿por qué?" en cada estado, pista tras cada acción,
  Conócela (catálogo + Wikipedia), 💬 Pregúntale (IA con el contexto de la
  planta), comentario sobre tu historial, comparar fotos, consejo de
  temporada, glosario, observaciones.

## Puesta en marcha

### 1. Backend (Apps Script) — pasar de la V4/5.0 a la 5.1
1. Abre el proyecto de Apps Script.
2. **Borra todos los archivos** (Main, Config, Plantas, Cuidados, Fotos,
   Personas, Identificacion, Diagnostico, Integridad, Migracion,
   SheetUtils, Validacion, Api, App.html, Index.html, Styles.html).
3. Crea un archivo `Planteate` y pega `apps-script/Planteate.gs`. Guarda.
4. **Implementar → Gestionar implementaciones → ✏️ → Versión: nueva →
   Implementar.** Así la URL `/exec` no cambia y la app sigue conectada.
5. En **Configuración del proyecto → Propiedades del script**, revisa:
   - `API_TOKEN`, `SPREADSHEET_ID`, `FOLDER_ID`, `PLANTNET_API_KEY` (ya existen).
   - `GEMINI_API_KEY`: gratis en https://aistudio.google.com/apikey
     (para crear fichas, Pregúntale y consejos del diagnóstico).
   - `APP_URL` = `https://angellagunak.github.io/Planteate/`
6. Ejecuta **una vez** `hacerFotosPrivadas` para quitar el acceso público
   a las fotos.

La primera vez que ejecutes funciones nuevas, Google pedirá permisos otra
vez (Drive, enviar a servicios externos, activadores). Acéptalos.

### 2. Avisos al móvil (gratis, sin correo)
Elige uno o varios. Se configuran en **Propiedades del script**.

**ntfy (recomendado: el más fácil)**
1. Instala la app **ntfy** (Android/iPhone).
2. Inventa un nombre de tema difícil de adivinar, p. ej. `planteate-casa-7f3k9`.
3. En la app ntfy: **+ → Suscribirse** a ese tema.
4. Propiedad `NTFY_TOPIC` = ese nombre.
   Todos los de casa pueden suscribirse al mismo tema.

**Telegram**
1. En Telegram habla con **@BotFather** → `/newbot` → copia el token.
2. Escribe cualquier cosa a tu bot. Abre
   `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia `chat.id`.
3. Propiedades `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.

**WhatsApp (CallMeBot, servicio gratuito no oficial)**
1. Sigue https://www.callmebot.com/blog/free-api-whatsapp-messages/
   para obtener tu `apikey` (solo para tu propio número).
2. Propiedades `CALLMEBOT_PHONE` (con prefijo, p. ej. `+34600…`) y
   `CALLMEBOT_APIKEY`.
   No es de Meta: puede dejar de funcionar sin aviso.

Después:
- Ejecuta **una vez** `activarAvisoDiario` (aviso cada día a las 9:00).
- En la app: **Ajustes → Avisos al móvil → Enviar aviso de prueba**.

### 3. Conectar la app
Abre la app, pega la URL `/exec` y el token. Para el resto de la casa:
**Ajustes → Copiar enlace para otra persona**.

### 4. Instalar en el móvil
- Android (Chrome): menú ⋮ → *Instalar aplicación*.
- iPhone (Safari): compartir → *Añadir a pantalla de inicio*.

## Desarrollo

- Probar en local: `powershell -File tools/servir.ps1` y abrir
  http://localhost:8080 (botón "Probar con datos de ejemplo").
- Tests de las reglas de cuidado: http://localhost:8080/tests/index.html
  (también publicados en `/tests/`).
- Al publicar cambios, **sube `VERSION` en `sw.js`**. La app se recarga
  sola con la versión nueva.
- Añadir una especie: nuevo objeto en `data/especies.json` (mismo formato).

## Columnas y hojas nuevas

Se crean solas al usarlas: columnas `especieId`, `Ubicación` en Plantas;
hoja `Especies` (fichas creadas con IA). Nuevos `tipoAccion`: `nutrir`,
`observacion`.

## Límites conocidos

- Identificar, diagnosticar, Pregúntale y crear fichas necesitan red.
- Las fichas creadas con IA son orientativas: revísalas.
- Quien tenga el enlace con token puede escribir. Compártelo solo en casa.
  Para cortar el acceso: ejecuta `crearTokenApi` otra vez y reconecta.
