// Reserva de plaza que se paga online con Stripe (tarjeta y Bizum).
// La usan la página /inscripcion y las funciones api/checkout.js y api/stripe-webhook.js.
// Es JavaScript (no TypeScript) para que las funciones de Vercel puedan importarlo tal cual.
export const RESERVA = {
  id: 'reserva-t2',
  concepto: 'Reserva de plaza · Temporada 2 RUKC',
  importe: 30, // euros, precio final
  reembolsable: false,
};

export const CATEGORIAS_RESERVA = ['Ligeros', 'Pesados', 'Aún no lo sé'];

// La inscripción de cada ronda cierra este número de días antes de la carrera (sábado -> martes anterior).
export const DIAS_CIERRE = 4;

// Bizum manual (mientras Stripe no permita Bizum): el piloto lo envía a este número y manda el justificante por WhatsApp.
// Para quitar la opción, deja `numero` vacío.
export const BIZUM = {
  numero: '659 69 85 05',
  titular: 'John R.F', // nombre que verá el piloto en su app al enviar el Bizum
};
