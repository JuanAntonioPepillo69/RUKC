// Ajustes generales de la web. Cambia aquí el teléfono, el mensaje de WhatsApp o los enlaces.
export const SITE = {
  name: 'RaceUp Karting Championship',
  short: 'RUKC',
  email: 'raceupkc@gmail.com',
  instagram: 'https://www.instagram.com/rukc2026/',
  whatsapp: {
    number: '34659698505',
    message: 'Hola, quiero información para correr la Temporada 2 de RUKC.',
  },
};

export const whatsappUrl = (message = SITE.whatsapp.message) =>
  `https://wa.me/${SITE.whatsapp.number}?text=${encodeURIComponent(message)}`;
