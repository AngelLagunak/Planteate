// Datos de ejemplo para probar la app sin conectar la hoja.
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

const plantas = [
  { id: 'demo_zz', 'Nombre Casa': 'Zeta', 'Ubicación': 'Salón', 'Nombre científico': 'Zamioculcas zamiifolia', Archivada: 'FALSE', 'Cumpleaños': hace(400), Origen: 'Comprada' },
  { id: 'demo_espa', 'Nombre Casa': 'Lirio del salón', 'Ubicación': 'Salón', 'Nombre científico': 'Spathiphyllum wallisii', Archivada: 'FALSE', 'Cumpleaños': hace(200), Origen: 'Regalo' },
  { id: 'demo_alba', 'Nombre Casa': 'Albahaca cocina', 'Ubicación': 'Cocina', 'Nombre científico': 'Ocimum basilicum', Archivada: 'FALSE', 'Cumpleaños': hace(60), Origen: 'Comprada' },
  { id: 'demo_cinta', 'Nombre Casa': 'Cinta colgante', 'Nombre científico': 'Chlorophytum comosum', Archivada: 'FALSE', Origen: 'Esqueje o propagación' },
  { id: 'demo_menta', 'Nombre Casa': 'Menta', 'Nombre científico': 'Mentha spicata', Archivada: 'TRUE', MotivoArchivado: 'muerta', FechaArchivado: hace(30) }
];

const acciones = [];
let n = 0;
const add = (plantaId, tipoAccion, dias, persona = 'Ángel') => acciones.push({ logId: 'demo_' + (n++), plantaId, tipoAccion, timestamp: hace(dias), persona });
[60, 38, 20].forEach((d) => add('demo_zz', 'riego', d));
[40, 33, 27, 22, 16, 11, 6].forEach((d, i) => add('demo_espa', 'riego', d, i % 2 ? 'Ana' : 'Ángel'));
add('demo_espa', 'abono', 45);
[9, 7, 5, 3].forEach((d) => add('demo_alba', 'riego', d, 'Ana'));
[30, 18].forEach((d) => add('demo_cinta', 'riego', d));
add('demo_cinta', 'fertilizante', 70);
['demo_zz', 'demo_espa', 'demo_alba', 'demo_cinta'].forEach((id) => ['riego', 'nutrir', 'trasplante'].forEach((t) => add(id, t, 90, 'Inicio Frecuencia')));

export const DEMO = { plantas, acciones, fotos: [], personas: ['Ana', 'Ángel'], inicioGlobal: null, servidor: new Date().toISOString() };
