# Base de conocimiento inicial del bot de RUKC (kb-semilla)

Versión 0.1 · 11 de noviembre de 2026
Fuentes: web raceupkc.com (portada, condiciones de la reserva, privacidad, inscripción) y datos dados por John.

Instrucciones para John: rellena todo lo marcado como `[JOHN: ...]`. Si un dato no lo sabes o no quieres que el bot lo diga, borra la línea: el bot escalará esa pregunta.
Instrucciones para Claude Code: cada sección `##` es un documento de `kb_documents` (slug = el indicado entre paréntesis). No cargues líneas que sigan teniendo `[JOHN: ...]`.

---

## Qué es RUKC (slug: liga)

- RUKC (RaceUp Karting Championship) es una liga de karting de alquiler en la provincia de Málaga, con formato de F1: entrenamiento, clasificación y carrera en cada ronda.
- Es una competición privada de karting de alquiler, no federada.
- Igualdad: karts de alquiler mecánicamente equivalentes y asignados por sorteo (nadie elige montura), motor igual para todos, lastre hasta el peso mínimo de cada categoría y dos categorías por peso.
- Hay reglamento, Dirección de Carrera, comisarios en pista y resultados oficiales. Un Comité de Comisarios de tres miembros resuelve las apelaciones.
- Pasaporte de penalización: las infracciones suman puntos; con 12 puntos en un año, el piloto se queda fuera de una ronda.
- Después de cada ronda se publican en la web la clasificación de la carrera y la del campeonato.
- Temporada 1: 6 carreras, 6 circuitos, 60 pilotos y 130 inscripciones.
- Formación incluida: contenido grabado (trazados, banderas y similares). No incluye tandas gratis ni coaching en pista. Enlace: [JOHN: enlace a la formación]
- Contacto: raceupkc@gmail.com · Instagram @RUKC2026

## Categorías y lastre (slug: categorias)

- Ligeros: de 70 a 80 kg. Peso mínimo 70 kg.
- Pesados: 85 kg o más. Peso mínimo 85 kg.
- Quien no llega al mínimo de su categoría lo completa con un cinturón de lastre (plomo en caderas y zona lumbar).
- Entre 80 y 85 kg, el piloto elige: bajar peso para correr en Ligeros o subir con lastre hasta 85 kg para correr en Pesados. La elección vale para toda la temporada. [JOHN: confirmar y publicarlo en la web o el reglamento antes de activar esta línea]
- En la inscripción se puede marcar "Aún no lo sé" y la categoría se decide con el equipo.
- El bot no pregunta ni guarda el peso de nadie. Si alguien duda de su categoría, se escala a John.

## Día de carrera (slug: dia_de_carrera)

- Acreditación y pesaje: una hora antes del briefing.
- Briefing: banderas, normas y seguridad.
- Entrenamiento: [JOHN: la web dice "de 5 a 10 minutos" y tú me dijiste 10 minutos; ¿cuál vale?]
- Clasificación: 10 minutos. La mejor vuelta decide la parrilla.
- Carrera: 15 minutos. Es la que da los puntos.
- Qué llevar: [JOHN: ropa, casco o guantes propios, documentación, etc.]
- Si alguien llega tarde al pesaje: [JOHN: qué pasa]
- Pago del resto en el circuito: [JOHN: efectivo, Bizum o tarjeta]

## Puntos (slug: puntos)

- La pole es para el mejor tiempo de la clasificación y da 2 puntos.
- La vuelta rápida da 2 puntos, pero solo cuenta si se marca en carrera (no en entrenamiento ni en clasificación).
- Puntos por posición en carrera: [JOHN: tabla de puntos, o "ver reglamento" con el artículo]

## Calendario Temporada 2 (slug: calendario)

Nota para Claude Code: este calendario debe salir de la tabla de rondas de la BD. Este bloque es solo para comprobar que coincide.

- R1 · sábado 17 de octubre de 2026 · Karting Mijas (ya celebrada)
- R2 · domingo 22 de noviembre de 2026 · Karting Campillos
- R3 · sábado 12 de diciembre de 2026 · Kart&Fun Málaga
- R4 · sábado 6 de febrero de 2027 · Karting del Sol
- R5 · sábado 13 de marzo de 2027 · Kart&Fun Málaga
- R6 · sábado 24 de abril de 2027 · Kart&Fun Estepona
- R7 · sábado 5 de junio de 2027 · Karting Mijas
- R8 · sábado 3 de julio de 2027 · Karting Campillos · Final y gala
- La inscripción de cada ronda cierra el martes anterior a la carrera, o antes si se llena la parrilla.
- Plazas por ronda: 100 (50 Ligeros y 50 Pesados).
- Por ronda: hora de acreditación, hora de briefing y enlace de Google Maps: [JOHN: rellenar en la tabla de rondas, al menos para R2 y R3]

## Precios y pago (slug: precios)

- Cada ronda cuesta 99 €.
- Para asegurar la plaza se paga una reserva de 30 €, que se descuenta del precio: después quedan 69 €, que se pagan en el circuito el día de la carrera.
- La reserva se paga con tarjeta (pantalla segura de Stripe) o con Bizum al 659 69 85 05 con el concepto que indica la web. Con Bizum hay que mandar el justificante por WhatsApp; la plaza queda reservada cuando John comprueba que ha llegado.
- Temporada completa restante (7 carreras, de la R2 a la R8): 620 €. Cómo se paga: [JOHN: por web, por Bizum o contigo; ¿hay reserva?]
- Una persona puede pagar la plaza de otra.
- Enlace de reserva: https://raceupkc.com/inscripcion

## Políticas (slug: politicas)

- La reserva no es reembolsable. Si después de pagarla el piloto decide no participar o no puede acudir, no se devuelve el importe.
- Al ser un servicio de ocio ligado a fechas concretas, no se aplica el derecho de desistimiento de 14 días (artículo 103, letra l, de la Ley General para la Defensa de los Consumidores y Usuarios).
- Si RUKC cancelara la temporada antes de su inicio, se devolvería la reserva íntegra.
- Cambio de ronda: [JOHN: ¿se puede, con cuánto aviso? Hasta que lo escribas, el bot lo escala]
- Ronda que no se celebra (lluvia, circuito, etc.): [JOHN: qué pasa con el dinero]
- Descuentos de grupo, créditos de fidelidad, códigos: [JOHN: reglas escritas o "no hay". Hasta entonces, se escala]
- Condiciones completas: https://raceupkc.com/condiciones-reserva

## Menores (slug: menores)

- Si el piloto es menor de edad, la inscripción la hace su padre, madre o tutor, y es el tutor quien recibe los mensajes y responde.
- La edad mínima para correr la fija cada circuito: [JOHN: edad mínima de Mijas, Campillos, Kart&Fun Málaga, Karting del Sol y Kart&Fun Estepona]
- Documentación del menor: [JOHN: ¿hace falta autorización firmada?]

## Enlaces (slug: enlaces)

- Web: https://raceupkc.com
- Temporada 2, calendario y clasificación: https://raceupkc.com/season-2
- Reservar plaza: https://raceupkc.com/inscripcion
- Reglamento: https://raceupkc.com/reglamento
- Condiciones de la reserva: https://raceupkc.com/condiciones-reserva
- Privacidad: https://raceupkc.com/privacidad
- Instagram: https://www.instagram.com/rukc2026/

## Preguntas frecuentes y objeciones (slug: faq)

Respuestas aprobadas por John. El bot las adapta a su voz, pero no cambia el fondo.

- "Es caro": [JOHN: tu respuesta]
- "Nunca he corrido": [JOHN: tu respuesta]
- "Peso mucho" o "peso poco": [JOHN: tu respuesta]
- "No conozco a nadie": [JOHN: tu respuesta]
- "¿Y si llueve?": [JOHN: tu respuesta]
- "¿Hay premios?": [JOHN: qué hay (medallas, trofeos, gala) o borrar]
