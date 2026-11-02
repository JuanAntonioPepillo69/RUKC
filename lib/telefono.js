// Normaliza teléfonos a E.164 (+34600112233). Sin prefijo, se asume España.
// Devuelve null si no parece un teléfono válido.
export function normalizarTelefono(valor) {
  if (valor == null) return null;
  let t = String(valor).trim().replace(/[\s().-]/g, '');
  if (!t) return null;
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (!t.startsWith('+')) {
    if (/^[6789]\d{8}$/.test(t)) t = `+34${t}`;
    else if (/^34[6789]\d{8}$/.test(t)) t = `+${t}`;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(t) ? t : null;
}
