// Reserva de plaza que se paga online con Stripe (tarjeta y Bizum).
// Textos de la web (landing, home, condiciones). El importe que se cobra sale de la base de datos (temporada.importe_reserva_cent).
// Es JavaScript (no TypeScript) para que las funciones de Vercel puedan importarlo tal cual.
export const RESERVA = {
  id: 'reserva-t2',
  concepto: 'Reserva de plaza · Temporada 2 RUKC',
  importe: 30, // euros, precio final
  precioCarrera: 99, // euros; la reserva se descuenta de este precio
  reembolsable: false,
};

// Bizum manual (mientras Stripe no permita Bizum): el piloto lo envía a este número y manda el justificante por WhatsApp.
// Para quitar la opción, deja `numero` vacío.
// Temporada completa: se reserva por WhatsApp. El total baja a medida que pasan rondas (y el precio por ronda sube), así
// que se actualiza a mano después de cada ronda. `hasta` es el último día en que vale: a partir del día siguiente la web
// deja de enseñar la cifra y remite al WhatsApp.
export const TEMPORADA_COMPLETA = { precio: 630, rondas: 7, hasta: '2026-11-21' };

export const BIZUM = {
  numero: '659 69 85 05',
  titular: 'John R.F', // nombre que verá el piloto en su app al enviar el Bizum
};
