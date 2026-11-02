# Base de datos RUKC · Decisiones tomadas durante la construcción

Complementa `diseno-v1.0.md` (fuente de verdad) y `prompt-maestro-v1.0.md`. Cada entrada resuelve una contradicción entre el diseño y el código que había, o una duda que el diseño no cerraba. Si una decisión cambia el diseño, se anota aquí y en la siguiente versión del diseño.

| # | Fecha | Tema | Decisión | Fase |
|---|---|---|---|---|
| D1 | 30 oct 2026 | Origen de cada visita | Se empieza a capturar la atribución: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, página de llegada y referrer, guardados en el navegador (`rukc_origen`) y registrados en `atribucion`. `fbc` y `fbp` solo con consentimiento de cookies. Hasta ahora `rukc_origen` solo guardaba la palabra `landing`. | 2 |
| D2 | 30 oct 2026 | Calendario y galerías | Mixto. Fecha, circuito y estado de cada ronda salen de la base de datos al publicar. Fotos, vídeos, bandera roja (`carrera`) y resultados siguen en la Google Sheet, unidos por el número de ronda. Si fecha o circuito no coinciden entre la Sheet y la base de datos, la publicación falla con un mensaje claro. | 2 |
| D3 | 30 oct 2026 | Cierre de inscripción | Manual, como el diseño: cada categoría se abre y cierra desde el panel (`cupo_ronda.estado_inscripcion`). Se quita el cierre automático del martes anterior (`DIAS_CIERRE` en `src/config/reserva.js`). La landing puede seguir anunciando la fecha de cierre como texto. | 2 |
| D4 | 30 oct 2026 | Reservas existentes | Se importan las reservas de la T2 ya cobradas (Stripe y Bizum) con un script al terminar la fase 2, a partir del CSV de pagos exportado de Stripe y de una lista de los Bizum que facilite John. | 2 |
| D5 | 30 oct 2026 | Propiedad del esquema | `rukc_migraciones` no es propietario del esquema `public` (en Postgres 18 el administrador de Neon no puede cederlo, error 42501): tiene `CREATE, USAGE` sobre él y es propietario de todo lo que crea. | 0 |
| D7 | 30 oct 2026 | Plan de Vercel y tareas programadas | El proyecto está en Vercel **Hobby**, no Pro. Todas las tareas programadas se agrupan en **una sola tarea diaria** (Vercel Cron, UTC, con `CRON_SECRET`), que ejecuta en orden: Bizum sin confirmar en 72 h a `pago_abandonado`, feedback caducado, copia de seguridad, consumo de Neon y, el día 1 de cada mes, la lista de anonimización. Consecuencia: un Bizum abandonado o un feedback caducado puede tardar hasta un día más en cambiar de estado. Los enlaces de feedback dejan de aceptar respuestas a su hora exacta, porque se comprueba `expira_en` al usarlos. El Blob privado se comprobará en Hobby cuando haga falta (fase 4). | 6 |
| D6 | 30 oct 2026 | Claves de Stripe | Las fases 2 a 6 se prueban con las claves de modo prueba (Sandbox) en local y en Preview. La clave restringida de producción necesitará el permiso `Refunds: Write` en la fase 6. | 2–6 |

## Fase 1 · decisiones de implementación del esquema

Detalles que el diseño no fija y que el esquema resuelve así. Se pueden cambiar con una migración nueva.

- **Extensión `btree_gist`** (además de pgcrypto y citext): permite impedir en la base de datos que se solapen las tarifas de un producto y que haya dos versiones vigentes del mismo documento legal.
- **Quién hace cada cambio:** la aplicación fija `rukc.actor` (`publico`, `sistema`, `stripe`, `admin:<id>`) y `rukc.ip` por transacción. El historial (`evento`) los copia y guarda solo las columnas de estado e importes, nunca datos personales.
- **Códigos legibles:** solicitud `RK-XXXX` (sin 0, O, 1 ni I), inscripción `T2-R2-0043`, pedido `T2-P-0001`, pago `PG-00001`.
- **Límite de lo aplicado a una inscripción:** cuentan también los pagos pendientes de verificar (Bizum avisado), para no comprometer dos veces la misma plaza. El estado de cobro, en cambio, solo cuenta los pagos confirmados.
- **Reembolsos:** antes de emitir un reembolso hay que reducir lo aplicado de ese pago a inscripciones, para que siempre se cumpla "aplicado ≤ importe − reembolsado". El panel de la fase 6 lo hará en un solo paso.
- **Traslados:** una inscripción solo pasa a `trasladada` si ya existe su fila en `traslado`. Los días de antelación se cuentan en hora de Madrid.
- **Envío de una solicitud:** para pasar a `enviada` hacen falta ronda, contacto y `acepta_documentos`.
- **Peso:** solo se guarda si la persona tiene un consentimiento de peso vigente y no revocado.
- **`evento`:** además de los permisos de `rukc_app`, un trigger impide modificarlo, borrarlo o vaciarlo a cualquier rol.
- **Borrado físico:** `rukc_app` conserva DELETE en las tablas de negocio, para corregir aplicaciones de pago, borrar borradores caducados, vistas guardadas y límites. La regla "nunca borrar" de las tablas de negocio la cumple la aplicación. En `evento` y `aceptacion` no tiene DELETE.
- **Valores no definidos en el diseño:** `solicitud_rgpd.tipo` (acceso, rectificación, supresión, oposición, limitación, portabilidad, retirada de consentimiento) y `estado` (pendiente, resuelta, rechazada). `consentimiento.origen` es texto libre.
- **Seed T2:** temporada `en_curso` del 17-10-2026 al 03-07-2027, tarifas vigentes desde el 01-09-2026, cupos todos `cerrada` (hay que abrirlos desde el panel antes de vender en la fase 2), documentos versión `borrador-1` sin activar y plantilla de feedback `v1` vacía e inactiva.

## Pendiente de confirmar

- Tipo de `evento.entidad_id`: `text` en la migración 0000 (el diseño no lo fija).
