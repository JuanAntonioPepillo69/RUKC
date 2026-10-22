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
