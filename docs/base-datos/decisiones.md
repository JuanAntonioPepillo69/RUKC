# Base de datos RUKC · Decisiones tomadas durante la construcción

Complementa `diseno-v1.0.md` (fuente de verdad) y `prompt-maestro-v1.0.md`. Cada entrada resuelve una contradicción entre el diseño y el código que había, o una duda que el diseño no cerraba. Si una decisión cambia el diseño, se anota aquí y en la siguiente versión del diseño.

| # | Fecha | Tema | Decisión | Fase |
|---|---|---|---|---|
| D1 | 30 oct 2026 | Origen de cada visita | Se empieza a capturar la atribución: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, página de llegada y referrer, guardados en el navegador (`rukc_origen`) y registrados en `atribucion`. `fbc` y `fbp` solo con consentimiento de cookies. Hasta ahora `rukc_origen` solo guardaba la palabra `landing`. | 2 |
| D2 | 30 oct 2026 | Calendario y galerías | Mixto. Fecha, circuito y estado de cada ronda salen de la base de datos al publicar. Fotos, vídeos, bandera roja (`carrera`) y resultados siguen en la Google Sheet, unidos por el número de ronda. Si fecha o circuito no coinciden entre la Sheet y la base de datos, la publicación falla con un mensaje claro. | 2 |
| D3 | 30 oct 2026 | Cierre de inscripción | Manual, como el diseño: cada categoría se abre y cierra desde el panel (`cupo_ronda.estado_inscripcion`). Se quita el cierre automático del martes anterior (`DIAS_CIERRE` en `src/config/reserva.js`). La landing puede seguir anunciando la fecha de cierre como texto. | 2 |
| D4 | 30 oct 2026 | Reservas existentes | Se importan las reservas de la T2 ya cobradas (Stripe y Bizum) con un script al terminar la fase 2, a partir del CSV de pagos exportado de Stripe y de una lista de los Bizum que facilite John. | 2 |
| D5 | 30 oct 2026 | Propiedad del esquema | `rukc_migraciones` no es propietario del esquema `public` (en Postgres 18 el administrador de Neon no puede cederlo, error 42501): tiene `CREATE, USAGE` sobre él y es propietario de todo lo que crea. | 0 |
| D6 | 30 oct 2026 | Claves de Stripe | Las fases 2 a 6 se prueban con las claves de modo prueba (Sandbox) en local y en Preview. La clave restringida de producción necesitará el permiso `Refunds: Write` en la fase 6. | 2–6 |

## Pendiente de confirmar

- Plan de Vercel (Hobby o Pro). El diseño da por hecho Pro: Cron cada hora y Blob privado.
- Tipo de `evento.entidad_id`: `text` en la migración 0000 (el diseño no lo fija).
