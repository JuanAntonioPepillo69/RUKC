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

## Fase 2 · decisiones de implementación de la captura web

- **Enlace de onboarding en la página de éxito:** la base de datos solo guarda el hash del token, así que el enlace no se puede volver a leer. `GET /api/checkout/estado` genera un token nuevo cada vez que se consulta (y sustituye el hash), mientras el administrador no haya enviado ya el enlace por WhatsApp. Un enlace anterior deja de valer cuando se genera otro.
- **Lista de espera:** el diseño no tiene tabla de lista de espera. Si el cupo está cerrado o en lista de espera, la web lo dice y ofrece un botón de WhatsApp con el código de la solicitud. La solicitud se queda en borrador con su ronda, a la vista en "Recuperar".
- **Categoría elegida en el formulario:** se guarda en la inscripción con `categoria_origen = por_peso` (la declara el piloto según su peso). "Aún no lo sé" deja la categoría pendiente.
- **Oportunidad:** la que pasa a "ganada" es la del pagador (quien contactó y pagó). Si paga por otra persona, el piloto se crea como persona aparte y es quien recibe la inscripción y el onboarding.
- **Método del pago con Stripe:** el webhook lee el tipo real del cobro (tarjeta, Bizum…) desde el PaymentIntent. Con la clave restringida de producción hace falta el permiso `PaymentIntents: Read`; sin él, se guarda `stripe_tarjeta`.
- **Documentos aceptados en el formulario:** mientras los documentos de la base de datos estén en BORRADOR, `acepta_documentos` guarda las versiones de las páginas publicadas (`web-2026-10-22` para condiciones y privacidad).
- **Aviso de borradores:** mientras el documento `aviso_borradores` no esté activado, el formulario muestra un texto provisional con la etiqueta "Texto provisional".
- **Pago repetido:** si el piloto ya tenía una inscripción activa en esa ronda y categoría, el pago se aplica a ella y se deja una nota para revisar, en vez de fallar.
- **Sesiones de Stripe antiguas** (anteriores a la base de datos, sin `solicitud_id`): el webhook las registra en `stripe_evento` y no hace nada más.
- **`src/config/site.ts` pasa a `site.js`** para que las funciones de `api/` puedan importarlo sin compilar TypeScript.
- **Versión de prueba:** `rukc-pruebas.vercel.app` (alias de la última publicación de prueba), con las variables de Preview (Neon desarrollo y Stripe en modo prueba). Stripe entra con el secreto de "Protection Bypass for Automation" en la URL del webhook.

## Fase 3 · decisiones de implementación del panel

- **Tablas de login:** las de Better Auth 1.7.10 con el prefijo `auth_` (`auth_usuario`, `auth_sesion`, `auth_cuenta`, `auth_verificacion`, `auth_dos_factores`) y sus columnas originales en inglés. Dentro de ellas se borra en cascada, como hace Better Auth. El rol del panel está en `admin`, unido por email.
- **Bloqueo:** 5 fallos en 15 min bloquean el email (contraseña) y la IP (código TOTP), con `limite_peticion`. Además, Better Auth bloquea el segundo factor tras sus propios intentos fallidos.
- **Segundo factor:** quien no lo tiene activado puede iniciar sesión, pero el panel solo le deja ir a `/admin/seguridad` para activarlo.
- **Funciones de Vercel:** todo `/api/admin/*` es una sola función y todo `/api/auth/*` otra, por el límite de 12 funciones del plan Hobby (vercel.json reescribe las rutas).
- **Venta con varios pagos:** el dinero confirmado cubre primero las rondas más próximas; lo pendiente de verificar va detrás.
- **Descuentos:** se reparten entre las inscripciones en proporción a su precio. El motivo de un descuento manual queda como nota en la ficha del pagador (el pedido no tiene columna de motivo).
- **Fusión de duplicados:** no se hace si el duplicado tiene documentos firmados (hay que fusionar al revés) o si los dos tienen onboarding, acceso al grupo, oportunidad, dorsal o ficha de piloto en la misma temporada. El duplicado queda anonimizado como "Fusionada".
- **Aplazar una ronda** cambia la fecha en la base de datos: hay que cambiarla también en la hoja, porque si no coinciden la web no se publica (D2). El panel lo avisa.
- **Exportaciones:** los datos sensibles posibles son fecha de nacimiento y peso, solo desde Inscripciones, con casilla y confirmación, y quedan en `evento`. El número de documento nunca se exporta.
- **Mensaje de confirmación por WhatsApp:** genera un enlace de onboarding nuevo y marca `enlace_enviado_en`; desde ese momento la página de éxito ya no genera otro.
- **Pantallas que llegan después:** Catálogo, Onboarding y grupo (fase 4), Feedback (fase 5), Documentos y RGPD (fase 6), como en el prompt maestro.

## Pendiente de confirmar

- Tipo de `evento.entidad_id`: `text` en la migración 0000 (el diseño no lo fija).
