// Atribución (decisión D1): guarda en el navegador de dónde llegó la visita para registrarlo con la reserva.
// - rukc_origen_primero: la primera llegada con origen conocido (no se vuelve a tocar).
// - rukc_origen: la última (se actualiza solo si la visita trae UTM o fbclid, o llega desde otra web).
// Solo se guardan parámetros de campaña, la página de llegada y la web de procedencia; nada personal.
// La misma lógica está en línea en src/landing/landing.html.
const CLAVES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'] as const;

try {
  const url = new URL(location.href);
  const datos: Record<string, string> = {};
  for (const k of CLAVES) {
    const v = url.searchParams.get(k);
    if (v) datos[k] = v.slice(0, 300);
  }
  let externa = '';
  try { externa = document.referrer && new URL(document.referrer).host !== location.host ? new URL(document.referrer).origin : ''; } catch {}
  const conCampana = Object.keys(datos).length > 0;
  const tiene = (k: string) => { try { return !!localStorage.getItem(k); } catch { return true; } };
  if (conCampana || externa || !tiene('rukc_origen')) {
    const origen = JSON.stringify({ ...datos, landing_path: location.pathname, referrer: externa || undefined, capturada_en: new Date().toISOString() });
    localStorage.setItem('rukc_origen', origen);
    if (!tiene('rukc_origen_primero')) localStorage.setItem('rukc_origen_primero', origen);
  }
} catch {}
