// Genera la plantilla de la hoja de la temporada (Excel) para subirla a Google Drive como Google Sheets.
// Uso: node tools/sheet/build-template.mjs  ->  tools/sheet/RUKC-Temporada-2.xlsx
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wb = new ExcelJS.Workbook();
wb.creator = 'RUKC';

const GOLD = 'FFD4A62A', INK = 'FF0A0A0B', SOFT = 'FFF6F3EC';
const LIST = (values) => ({ type: 'list', allowBlank: true, formulae: [`"${values.join(',')}"`] });

function sheet(name, columns, rows = [], validations = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(([header, width]) => ({ header, key: header, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: INK } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
  for (const r of rows) ws.addRow(r);
  // Validaciones en las 300 primeras filas
  for (const [col, rule] of Object.entries(validations)) {
    const idx = columns.findIndex(([h]) => h === col) + 1;
    for (let i = 2; i <= 300; i++) ws.getCell(i, idx).dataValidation = rule;
  }
  return ws;
}

sheet('Config', [['clave', 18], ['valor', 70]], [
  ['descarte', 'auto'],
  ['aviso', ''],
], { valor: undefined });

sheet('Rondas', [['ronda', 8], ['fecha', 13], ['circuito', 24], ['estado', 14], ['carrera', 12], ['nota', 30]], [
  [1, '17/10/2026', 'Karting Mijas', '', '', ''],
  [2, '21/11/2026', 'Karting Campillos', '', '', ''],
  [3, '12/12/2026', 'Kart&Fun Málaga', '', '', ''],
  [4, '06/02/2027', 'Karting del Sol', '', '', ''],
  [5, '13/03/2027', 'Kart&Fun Málaga', '', '', ''],
  [6, '24/04/2027', 'Kart&Fun Estepona', '', '', ''],
  [7, '05/06/2027', 'Karting Mijas', '', '', ''],
  [8, '03/07/2027', 'Karting Campillos', '', '', 'Final y gala'],
], {
  estado: LIST(['programada', 'disputada', 'aplazada', 'cancelada']),
  carrera: LIST(['completa', 'mitad', 'nula']),
});

sheet('Pilotos', [['dorsal', 8], ['nombre', 28], ['categoria', 12]], [], {
  categoria: LIST(['Ligeros', 'Pesados', 'Ambas']),
});

const X = LIST(['x']);
sheet('Resultados', [
  ['ronda', 8], ['categoria', 12], ['dorsal', 8], ['posicion', 10], ['finaliza', 9], ['pole', 7], ['vuelta_rapida', 13],
  ['constancia', 11], ['pierde_bonus', 13], ['dsq', 6], ['salida', 8], ['mejor_vuelta', 13],
], [], {
  categoria: LIST(['Ligeros', 'Pesados']),
  finaliza: LIST(['sí', 'no']),
  pole: X, vuelta_rapida: X, constancia: X, pierde_bonus: X, dsq: X,
});

sheet('Sanciones', [['fecha', 13], ['ronda', 8], ['dorsal', 8], ['pp', 6], ['motivo', 50]]);
sheet('Menciones', [['ronda', 8], ['titulo', 24], ['dorsal', 8], ['texto', 60]]);

// Pestaña de ayuda (la web no la lee)
const help = wb.addWorksheet('Instrucciones');
help.getColumn(1).width = 22; help.getColumn(2).width = 110;
const lines = [
  ['CÓMO ACTUALIZAR LA WEB', ''],
  ['1', 'Tras cada carrera, rellena Resultados (una fila por piloto) y, si hace falta, Sanciones y Menciones.'],
  ['2', 'Menú RUKC > Publicar web. En un minuto la web muestra calendario, resultados y clasificaciones nuevas.'],
  ['3', 'Si algo está mal escrito, la web NO se actualiza y la versión anterior sigue online. El error aparece en el panel de Vercel.'],
  ['', ''],
  ['NO CAMBIES', 'El nombre de las pestañas ni los títulos de la fila 1. Puedes añadir columnas a la derecha para uso interno.'],
  ['NO PONGAS AQUÍ', 'Pesos, teléfonos, correos ni datos personales: esta hoja es pública con el enlace.'],
  ['', ''],
  ['PESTAÑA', 'COLUMNAS'],
  ['Config', 'descarte: auto (se aplica al final de la temporada), si o no. aviso: texto opcional que sale arriba en la página de la temporada.'],
  ['Rondas', 'ronda, fecha (17/10/2026), circuito, estado (vacío = disputada si tiene resultados), carrera (vacío = completa; mitad o nula con bandera roja, Art. 31 quater), nota.'],
  ['Pilotos', 'dorsal, nombre tal y como se publicará (por ejemplo "Carlos M."), categoria (Ligeros, Pesados o Ambas si compite en las dos; en ese caso, en Resultados indica siempre la categoría).'],
  ['Resultados', 'ronda, categoria (vacío = la del piloto), dorsal, posicion (vacía si no clasifica), finaliza (vacío = sí si tiene posición), pole, vuelta_rapida, constancia, pierde_bonus, dsq (marca con x), salida (posición de salida, opcional, para la mayor remontada), mejor_vuelta (opcional).'],
  ['', 'La posición puede ser la de la clasificación conjunta: la web la recalcula dentro de cada categoría. Los puntos se calculan solos.'],
  ['Sanciones', 'fecha (o deja la fecha vacía y pon la ronda), ronda, dorsal, pp (puntos de penalización del Art. 44), motivo.'],
  ['Menciones', 'ronda, titulo (por ejemplo "Piloto del día"), dorsal (opcional), texto. Pole, vuelta rápida, constancia y mayor remontada salen solas.'],
];
for (const l of lines) help.addRow(l);
for (const r of [1, 9]) help.getRow(r).font = { bold: true, color: { argb: GOLD } };
help.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'top' }; });
help.getRow(6).font = { bold: true }; help.getRow(7).font = { bold: true, color: { argb: 'FFD10007' } };
void SOFT;

const out = path.join(here, 'RUKC-Temporada-2.xlsx');
await wb.xlsx.writeFile(out);
console.log('ok', out);
