// Lee la temporada desde Google Sheets (o desde los datos DEMO si no hay hoja conectada) y la valida.
// La hoja debe estar compartida como "Cualquier persona con el enlace: lector" (se descarga como Excel).
// Su ID va en la variable de entorno RUKC_SHEET_ID (en Vercel: Settings > Environment Variables).
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import path from 'node:path';
import type { Carrera, Categoria, Config, EstadoRonda, Mencion, Piloto, Resultado, Ronda, Sancion, Temporada } from './types.ts';

export const PESTANAS = ['Config', 'Rondas', 'Pilotos', 'Resultados', 'Sanciones', 'Menciones'] as const;
type Pestana = (typeof PESTANAS)[number];
type Fila = Record<string, string>;

// ---------- CSV ----------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
// "Vuelta rápida" -> "vuelta_rapida"
const clave = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function aFilas(rows: string[][]): Fila[] {
  const [head = [], ...body] = rows;
  const keys = head.map(clave);
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// ---------- lectura ----------
// Datos DEMO: un CSV por pestaña en data/demo
async function leerDemo(tab: Pestana): Promise<Fila[]> {
  const file = path.join(process.cwd(), 'data', 'demo', `${tab.toLowerCase()}.csv`);
  return aFilas(parseCsv(await fs.readFile(file, 'utf8')));
}

// Hoja real: se descarga entera como Excel en una sola petición. Así no hay que publicar cada pestaña
// y las fechas y números llegan tal cual (la exportación CSV de Google adivina tipos y puede vaciar celdas).
const texto = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return texto(v.result as ExcelJS.CellValue);
    return '';
  }
  return String(v);
};
async function leerHoja(sheetId: string): Promise<Record<Pestana, Fila[]>> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) {
    throw new Error(`No se pudo descargar la hoja de la temporada (HTTP ${res.status}). Compártela como "Cualquier persona con el enlace: lector" y revisa RUKC_SHEET_ID.`);
  }
  return leerLibro(await res.arrayBuffer());
}

/** Convierte el Excel de la hoja en filas por pestaña. */
/**
 * Quita del Excel las "tablas" (Insertar tabla / Dar formato como tabla en Google Sheets o Excel).
 * Solo son formato, no datos, y exceljs falla al leer las que exporta Google.
 */
async function sinTablas(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  const tablas = Object.keys(zip.files).filter((n) => /^xl\/tables\//.test(n));
  if (!tablas.length) return buf;
  for (const n of tablas) zip.remove(n);
  for (const n of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) {
      const x = await zip.file(n)!.async('string');
      zip.file(n, x.replace(/<tableParts[\s\S]*?<\/tableParts>|<tableParts[^>]*\/>/g, ''));
    } else if (/^xl\/worksheets\/_rels\/.*\.rels$/.test(n)) {
      const x = await zip.file(n)!.async('string');
      zip.file(n, x.replace(/<Relationship [^>]*Target="[^"]*tables\/[^"]*"[^>]*\/>/g, ''));
    } else if (n === '[Content_Types].xml') {
      const x = await zip.file(n)!.async('string');
      zip.file(n, x.replace(/<Override [^>]*PartName="\/xl\/tables\/[^"]*"[^>]*\/>/g, ''));
    }
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

export async function leerLibro(buf: ArrayBuffer): Promise<Record<Pestana, Fila[]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await sinTablas(buf));
  const out = {} as Record<Pestana, Fila[]>;
  for (const tab of PESTANAS) {
    const ws = wb.getWorksheet(tab);
    if (!ws) throw new Error(`Falta la pestaña "${tab}" en la hoja (el nombre tiene que ser exactamente ese).`);
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(texto(row.getCell(c).value).trim());
      if (cells.some((x) => x)) rows.push(cells);
    });
    out[tab] = aFilas(rows);
  }
  return out;
}

// ---------- conversión y validación ----------
class Errores {
  list: string[] = [];
  add(tab: string, fila: number, msg: string) { this.list.push(`${tab}, fila ${fila + 2}: ${msg}`); }
}
const SI = new Set(['x', 'si', 'sí', 's', 'true', 'verdadero', '1', 'yes']);
const bool = (v: string | undefined) => SI.has((v ?? '').trim().toLowerCase());
const int = (v: string | undefined): number | null => {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
/** Acepta 2026-10-17, 17/10/2026 y 17/10/26. */
function fecha(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const categoria = (v: string | undefined): Categoria | null => {
  const s = clave(v ?? '');
  return s.startsWith('lig') ? 'Ligeros' : s.startsWith('pes') ? 'Pesados' : null;
};

export function construirTemporada(tabs: Record<Pestana, Fila[]>, demo: boolean): Temporada {
  const e = new Errores();

  const cfg = Object.fromEntries(tabs.Config.map((f) => [clave(f.clave ?? ''), f.valor ?? '']));
  const descarte = clave(cfg.descarte ?? 'auto');
  const config: Config = {
    descarte: descarte === 'si' ? 'si' : descarte === 'no' ? 'no' : 'auto',
    aviso: cfg.aviso ?? '',
  };

  const conResultados = new Set(tabs.Resultados.map((f) => int(f.ronda)));
  const rondas: Ronda[] = [];
  tabs.Rondas.forEach((f, i) => {
    const n = int(f.ronda), d = fecha(f.fecha);
    if (!n || Number.isNaN(n)) return e.add('Rondas', i, `"ronda" debe ser un número (está "${f.ronda}")`);
    if (!d) return e.add('Rondas', i, `fecha no válida "${f.fecha}" (usa 17/10/2026)`);
    if (!f.circuito) e.add('Rondas', i, 'falta el circuito');
    let estado = clave(f.estado) as EstadoRonda;
    if (!estado) estado = conResultados.has(n) ? 'disputada' : 'programada';
    if (!['programada', 'disputada', 'aplazada', 'cancelada'].includes(estado)) e.add('Rondas', i, `estado "${f.estado}" no válido (programada, disputada, aplazada o cancelada)`);
    const carrera = (clave(f.carrera) || 'completa') as Carrera;
    if (!['completa', 'mitad', 'nula'].includes(carrera)) e.add('Rondas', i, `carrera "${f.carrera}" no válida (completa, mitad o nula)`);
    if (rondas.some((r) => r.ronda === n)) e.add('Rondas', i, `la ronda ${n} está repetida`);
    rondas.push({ ronda: n, fecha: d, circuito: f.circuito, estado, carrera, nota: f.nota ?? '' });
  });
  rondas.sort((a, b) => a.ronda - b.ronda);

  const pilotos: Piloto[] = [];
  tabs.Pilotos.forEach((f, i) => {
    const d = int(f.dorsal), c = categoria(f.categoria);
    if (!d || Number.isNaN(d)) return e.add('Pilotos', i, `dorsal no válido "${f.dorsal}"`);
    if (!f.nombre) e.add('Pilotos', i, `falta el nombre del dorsal ${d}`);
    if (!c) e.add('Pilotos', i, `categoría "${f.categoria}" no válida (Ligeros o Pesados)`);
    if (pilotos.some((p) => p.dorsal === d)) e.add('Pilotos', i, `el dorsal ${d} está repetido`);
    pilotos.push({ dorsal: d, nombre: f.nombre, categoria: c ?? 'Ligeros' });
  });

  const resultados: Resultado[] = [];
  tabs.Resultados.forEach((f, i) => {
    const r = int(f.ronda), d = int(f.dorsal), pos = int(f.posicion), salida = int(f.salida);
    const piloto = pilotos.find((p) => p.dorsal === d);
    if (!r || !rondas.some((x) => x.ronda === r)) return e.add('Resultados', i, `la ronda "${f.ronda}" no está en la pestaña Rondas`);
    if (!d || !piloto) return e.add('Resultados', i, `el dorsal "${f.dorsal}" no está en la pestaña Pilotos`);
    if (Number.isNaN(pos) || (pos !== null && pos < 1)) e.add('Resultados', i, `posición no válida "${f.posicion}"`);
    if (Number.isNaN(salida)) e.add('Resultados', i, `salida no válida "${f.salida}"`);
    // La categoría de la fila manda; si está vacía, la del piloto (los puntos no pasan de una categoría a otra, Art. 18 bis)
    const cat = f.categoria ? categoria(f.categoria) : piloto.categoria;
    if (!cat) e.add('Resultados', i, `categoría "${f.categoria}" no válida`);
    if (resultados.some((x) => x.ronda === r && x.dorsal === d)) e.add('Resultados', i, `el dorsal ${d} aparece dos veces en la ronda ${r}`);
    resultados.push({
      ronda: r, categoria: cat ?? piloto.categoria, dorsal: d, posicion: Number.isNaN(pos) ? null : pos,
      finaliza: f.finaliza === undefined || f.finaliza === '' ? pos !== null : bool(f.finaliza),
      pole: bool(f.pole), vueltaRapida: bool(f.vuelta_rapida), constancia: bool(f.constancia),
      pierdeBonus: bool(f.pierde_bonus), dsq: bool(f.dsq),
      salida: Number.isNaN(salida) ? null : salida, mejorVuelta: f.mejor_vuelta ?? '',
    });
  });
  // Pole y vuelta rápida: una por ronda y categoría
  for (const r of rondas) for (const c of ['Ligeros', 'Pesados'] as Categoria[]) {
    const rs = resultados.filter((x) => x.ronda === r.ronda && x.categoria === c);
    if (rs.filter((x) => x.pole).length > 1) e.list.push(`Resultados: más de una pole en la ronda ${r.ronda} (${c})`);
    if (rs.filter((x) => x.vueltaRapida).length > 1) e.list.push(`Resultados: más de una vuelta rápida en la ronda ${r.ronda} (${c})`);
    const pos = rs.map((x) => x.posicion).filter((p) => p !== null);
    if (new Set(pos).size !== pos.length) e.list.push(`Resultados: posiciones repetidas en la ronda ${r.ronda} (${c})`);
  }

  const sanciones: Sancion[] = [];
  tabs.Sanciones.forEach((f, i) => {
    const d = int(f.dorsal), pp = int(f.pp), r = int(f.ronda);
    const fr = fecha(f.fecha) ?? rondas.find((x) => x.ronda === r)?.fecha ?? null;
    if (!d || !pilotos.some((p) => p.dorsal === d)) return e.add('Sanciones', i, `el dorsal "${f.dorsal}" no está en Pilotos`);
    if (pp === null || Number.isNaN(pp)) return e.add('Sanciones', i, `"pp" debe ser un número`);
    if (!fr) return e.add('Sanciones', i, 'falta la fecha o una ronda válida');
    sanciones.push({ fecha: fr, ronda: r && !Number.isNaN(r) ? r : null, dorsal: d, pp, motivo: f.motivo ?? '' });
  });

  const menciones: Mencion[] = [];
  tabs.Menciones.forEach((f, i) => {
    const r = int(f.ronda), d = int(f.dorsal);
    if (!r || !rondas.some((x) => x.ronda === r)) return e.add('Menciones', i, `la ronda "${f.ronda}" no está en Rondas`);
    if (!f.titulo) return e.add('Menciones', i, 'falta el título');
    if (d !== null && (Number.isNaN(d) || !pilotos.some((p) => p.dorsal === d))) return e.add('Menciones', i, `el dorsal "${f.dorsal}" no está en Pilotos`);
    menciones.push({ ronda: r, titulo: f.titulo, dorsal: d, texto: f.texto ?? '' });
  });

  if (e.list.length) throw new Error(`La hoja de la temporada tiene errores:\n- ${e.list.join('\n- ')}`);
  return { config, rondas, pilotos, resultados, sanciones, menciones, demo };
}

let cache: Promise<Temporada> | null = null;
/** Una sola lectura por compilación, compartida por todas las páginas. */
export function cargarTemporada(): Promise<Temporada> {
  cache ??= (async () => {
    const sheetId = (import.meta.env?.RUKC_SHEET_ID as string | undefined) || process.env.RUKC_SHEET_ID || undefined;
    const tabs = sheetId
      ? await leerHoja(sheetId)
      : (Object.fromEntries(await Promise.all(PESTANAS.map(async (t) => [t, await leerDemo(t)]))) as Record<Pestana, Fila[]>);
    return construirTemporada(tabs, !sheetId);
  })();
  return cache;
}
