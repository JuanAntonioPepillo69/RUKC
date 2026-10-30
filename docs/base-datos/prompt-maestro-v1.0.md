# Prompt maestro · Base de datos RUKC · Diseño v1.0

Copia todo lo que hay debajo de la línea en Claude Code, dentro del repo de raceupkc.com.
Antes, guarda el documento de diseño exportado en Markdown en `docs/base-datos/diseno-v1.0.md`.

---

## Quién eres y qué vas a construir

Eres el desarrollador de la base de datos de RUKC (RaceUp Karting Championship), una liga de karting de alquiler gestionada por una sola persona, John. Vas a añadir a este repo una base de datos única y un panel privado que registran:

1. Quién empieza el formulario de inscripción y no lo termina o no paga.
2. Quién paga, cuánto, con qué método y qué rondas cubre.
3. Los leads que John da de alta a mano desde WhatsApp.
4. El onboarding obligatorio tras pagar y el acceso aprobado al grupo de WhatsApp de pilotos.
5. El feedback post-carrera: a quién se envió, quién respondió, quién falta y qué contestó.

## Fuente de verdad

- El diseño completo está en `docs/base-datos/diseno-v1.0.md`. Léelo entero antes de empezar y vuelve a él en cada fase.
- Si el código actual o una petición mía contradice el diseño, **para y pregúntame** antes de seguir. No resuelvas contradicciones por tu cuenta.
- Si algo no está en el diseño, no lo inventes: pregúntame.

## Lo que ya existe (no lo rompas)

- Astro 7.3.5 con `output: 'static'`, `build.format: 'file'`, `trailingSlash: 'never'`. **No cambies el modo de salida ni añadas adaptador.**
- Funciones de servidor en la carpeta `api/` del repo, ejecutadas por Vercel (no por Astro): `api/checkout`, `api/stripe-webhook`, `api/lead`, `api/_meta.js`.
- Stripe Checkout creado por la API REST, sin librería. Mantén ese estilo salvo que te diga otra cosa.
- Meta: píxel en la landing y API de conversiones desde el servidor.
- Google Sheets: datos de temporada leídos al publicar (`RUKC_SHEET_ID`) y botón "Publicar web" en Apps Script con `DEPLOY_HOOK_URL`.
- Hosting en Vercel Pro.

## Stack nuevo (decidido, no lo cambies)

| Pieza | Elección |
| --- | --- |
| Base de datos | Neon Postgres, región UE (Fráncfort) |
| Acceso | `@neondatabase/serverless` con SQL parametrizado. Sin ORM |
| Migraciones | Archivos `db/migrations/NNNN_descripcion.sql` + `db/migrar.mjs`, que los aplica en orden y registra cuáles se aplicaron |
| Login del panel | Better Auth en el propio repo: email + contraseña + TOTP obligatorio, tablas en Neon |
| Archivos | Vercel Blob, almacén **privado** |
| Tareas programadas | Vercel Cron (UTC) protegido con `CRON_SECRET` |
| Validación | Un esquema por endpoint (zod o equivalente) |

## Reglas de trabajo (obligatorias)

1. **Una fase cada vez.** Al terminar una fase haces sus verificaciones, me das el informe y **paras**. No empiezas la siguiente hasta que te escriba exactamente `OK fase N`.
2. **Una rama de git por fase** (`bd/fase-N-nombre`), con commits pequeños y mensajes en español. Nada se fusiona a `main` sin mi OK.
3. **Entornos.** Todo se desarrolla y prueba contra una rama de Neon de desarrollo y Stripe en modo test. Producción solo se toca en la fase 7.
4. **Migraciones.** Una migración aplicada nunca se edita: los cambios van en una migración nueva. Cada migración es idempotente o falla limpio.
5. **Secretos.** Nunca en el código ni en commits. Si necesitas una variable nueva, la añades a `.env.example` con un comentario y me dices dónde configurarla.
6. **Textos legales.** No redactes textos legales definitivos. Crea documentos marcados `BORRADOR` con `revisado_abogado_en` vacío; el sistema no debe poder activarlos sin esa fecha.
7. **Idioma.** Base de datos, código de negocio e interfaz en español. Sin emojis en textos de la interfaz ni en mensajes para pilotos.
8. **Nada privado se indexa.** `/admin*`, `/onboarding*`, `/feedback*` y `/api*` llevan `X-Robots-Tag: noindex, nofollow`, quedan fuera del sitemap y en `Disallow` de robots.txt. En esas páginas no hay píxel de Meta ni scripts de terceros.
9. **Sin datos personales en URLs ni en metadatos de Stripe.** Solo identificadores y códigos.
10. **Si algo falla o no puedes verificarlo, dilo.** No marques nada como hecho sin evidencia.

## Formato del informe al final de cada fase

```
FASE N — <nombre>
Hecho: <lista corta>
Archivos creados o modificados: <lista>
Verificaciones: <cada una con OK o FALLO y la evidencia: salida del test, consulta, captura>
Qué tiene que probar John a mano: <pasos numerados>
Lo que John tiene que configurar fuera del repo: <variables, paneles de Neon, Stripe o Vercel>
Desviaciones del diseño: <ninguna, o cuáles y por qué>
Riesgos o dudas abiertas: <lista>
Estoy parado esperando "OK fase N".
```

---

## FASE 0 · Preparación

Objetivo: dejar el repo listo para trabajar con la base de datos sin tocar nada visible.

1. Lee `docs/base-datos/diseno-v1.0.md` completo y devuélveme en 10 líneas como máximo qué vas a construir. Señala cualquier contradicción con el código actual.
2. Crea la estructura: `db/migrations/`, `db/migrar.mjs`, `db/tests/`, `lib/db.js` (conexión), `lib/validacion/`, `api/admin/`, `src/pages/admin/`.
3. `db/migrar.mjs`: lee `DATABASE_URL_MIGRACIONES`, crea la tabla `_migraciones` si no existe, aplica en orden las pendientes dentro de una transacción cada una y para al primer error.
4. Migración `0000_base.sql`: extensiones (`pgcrypto`, `citext`), función `set_actualizado_en()` y tabla `evento` vacía.
5. Añade a `.env.example`: `DATABASE_URL`, `DATABASE_URL_MIGRACIONES`, `RUKC_DATA_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`.
6. Dime exactamente qué tengo que hacer yo en Neon: crear el proyecto en región UE, la rama de desarrollo, y los dos roles (`rukc_app`, `rukc_migraciones`) con sus cadenas de conexión.

**Verificación**
- `node db/migrar.mjs` contra la rama de desarrollo aplica `0000` y una segunda ejecución no hace nada.
- `npm run build` sigue funcionando y el sitio público genera las mismas páginas que antes (compara el listado de `dist/`).

**PARA.**

---

## FASE 1 · Esquema completo

Objetivo: todas las tablas, reglas, vistas y datos iniciales del diseño, probados.

1. Migraciones por bloques, en este orden: identidad y captación; catálogo; venta y dinero; onboarding, feedback y sistema; vistas. Columnas, tipos, CHECK, UNIQUE y FK exactamente como en el diseño, con `ON DELETE RESTRICT`.
2. Índices en todas las FK y en los campos de búsqueda: `persona.telefono`, `persona.email`, `solicitud_inscripcion.codigo`, `pago.referencia_externa` y los `token_hash`.
3. Triggers:
    1. `actualizado_en` en todas las tablas de negocio.
    2. Escritura en `evento` de todo cambio de estado, de importes y de aceptaciones.
    3. `aplicacion_pago`: lo aplicado de un pago no supera su importe menos lo reembolsado, y lo aplicado a una inscripción no supera su precio.
    4. `movimiento_credito`: el saldo de una persona nunca baja de cero.
    5. Inscripción: recalcula `pendiente_pago`, `reservada` o `pagada` a partir del saldo cada vez que cambian aplicaciones, créditos o reembolsos. Esos tres estados no se pueden poner a mano.
    6. Transiciones: una función por entidad con estado que rechaza cualquier transición que no esté en la sección "Estados y transiciones" del diseño.
    7. `aceptacion` y `evento`: solo se puede insertar; en `aceptacion` solo se puede actualizar `revocada_en`.
4. Unicidad de inscripción: UNIQUE (piloto, ronda, categoría) solo para inscripciones activas, más UNIQUE (piloto, ronda) cuando la categoría es nula. La regla de cuántas categorías puede usar un piloto de la franja 80,1–84,9 kg es configuración: crea en `temporada` la columna `franja_ambas_categorias boolean` y no la apliques en el esquema.
5. Permisos: `rukc_app` sin UPDATE ni DELETE en `evento`, sin DELETE en `aceptacion` y sin permisos de esquema.
6. Vistas: `v_embudo`, `v_leads`, `v_inscripciones`, `v_parrilla`, `v_pagos`, `v_caja`, `v_onboarding`, `v_feedback`, `v_creditos`, `v_persona_360`, con las columnas del diseño.
7. Datos iniciales (`db/seed/t2.sql`, separado de las migraciones):
    1. Temporada T2: reserva de 3000 céntimos, 14 días de aviso para traslados.
    2. Circuitos y las 8 rondas con las fechas publicadas en la web: R1 17-10-2026 Karting Mijas · R2 21-11-2026 Karting Campillos · R3 12-12-2026 Kart&Fun Málaga · R4 06-02-2027 Karting del Sol · R5 13-03-2027 Kart&Fun Málaga · R6 24-04-2027 Kart&Fun Estepona · R7 05-06-2027 Karting Mijas · R8 03-07-2027 Karting Campillos (final y gala). R1 en estado `celebrada`. Edad mínima y seguro vacíos.
    3. Categorías LIG (mínimo 70,0) y PES (mínimo 85,0) y `regla_categoria` (80,0 → LIG; 84,9 → elección; resto → PES).
    4. Cupos de 50 por ronda y categoría, todos `cerrada`.
    5. Productos y tarifas: carrera suelta 9900, temporada completa 69000, temporada resto 63000.
    6. Una `entidad_cobradora` con nombre comercial RUKC y los demás campos vacíos para que los rellene John.
    7. Documentos legales en `BORRADOR`, sin activar.
8. Tests en `db/tests/` (script Node que crea datos, comprueba y limpia). Como mínimo:
    1. Una transición no permitida falla.
    2. Un pago no se puede aplicar por encima de su importe.
    3. Una inscripción pasa sola de `pendiente_pago` a `reservada` (30 €) y a `pagada` (99 €).
    4. Un reembolso parcial devuelve una inscripción `pagada` a `reservada`.
    5. El saldo de créditos no baja de cero.
    6. Nadie puede tener dos inscripciones activas en la misma ronda y categoría.
    7. Con la categoría nula, tampoco dos en la misma ronda.
    8. `rukc_app` no puede borrar de `evento`.
    9. Una aceptación no se puede editar.

**Verificación**
- Todas las migraciones se aplican desde cero en una rama nueva de Neon.
- Todos los tests pasan; pega la salida.
- Consulta a `v_parrilla` con el seed: 8 rondas × 2 categorías con 50 plazas.

**PARA.**

---

## FASE 2 · Captura desde la web (formulario, Stripe, Bizum)

Objetivo: flujos F1 y F2 del diseño, de punta a punta, en modo test.

1. `GET /api/catalogo`: rondas futuras con el estado de cupo por categoría, más precios y el importe de reserva vigentes. Cabecera de caché corta (60 s).
2. `POST /api/solicitud` y `PATCH /api/solicitud`: crean y actualizan el borrador en cuanto hay teléfono o email válido. Devuelven un token de borrador que se guarda en `sessionStorage`. Guardan la atribución desde `rukc_origen` y el consentimiento de medición. Límite de peticiones y campo trampa.
3. `/inscripcion`:
    1. Aviso de borradores visible encima del formulario. El texto sale del documento legal `aviso_borradores`; mientras esté en borrador, usa un texto provisional marcado.
    2. Rondas y categorías cargadas de `/api/catalogo`.
    3. Opción "Pago por otra persona", con nombre y WhatsApp del piloto.
    4. Casilla de comunicaciones comerciales aparte, desmarcada.
    5. Autoguardado tras 2 s sin escribir y en cada cambio de paso.
    6. Mantén el diseño visual actual.
4. `POST /api/checkout`:
    1. Valida y comprueba el cupo. Cerrado → mensaje y opción de lista de espera. Lleno pero abierto → sigue y marca sobrecupo.
    2. Pasa la solicitud a `enviada`.
    3. Tarjeta: sesión de Stripe por el importe de reserva, caducidad de 30 min, metadatos solo con `solicitud_id`.
    4. Bizum: página con número, importe y código `RK-XXXX`. El enlace de WhatsApp lleva **solo** el código; elimina el envío actual de nombre, correo y teléfono en la URL.
    5. Envía Lead a Meta solo si hay consentimiento.
5. `api/stripe-webhook`:
    1. Mantén la verificación de firma.
    2. Añade idempotencia con `stripe_evento`.
    3. `checkout.session.completed` y `async_payment_succeeded`: ejecuta en una sola transacción el paso 6 de F1 (personas sin sobrescribir datos, oportunidad ganada, pedido, inscripción, pago, aplicación, onboarding y solicitud pagada).
    4. `checkout.session.expired`: solicitud a `pago_abandonado`.
    5. `async_payment_failed`: pago fallido.
    6. Purchase a Meta fuera de la transacción, con `event_id` = id del pago.
6. `GET /api/checkout/estado`: para la página de éxito; devuelve el enlace de onboarding solo si la solicitud está pagada.
7. Calendario público: las páginas que hoy leen rondas del Google Sheet pasan a leerlas de la base de datos al publicar. Los resultados siguen saliendo del Sheet. No cambies el aspecto de las páginas.

**Verificación (Stripe en modo test, despliegue de preview)**
- Borrador creado al escribir el teléfono; aparece en `v_embudo`.
- Pago con tarjeta de test: solicitud `pagada`, inscripción `reservada` con 30 € aplicados, onboarding `pendiente` y Purchase enviado.
- Reenviar el mismo evento de Stripe no duplica nada.
- Sesión caducada: solicitud `pago_abandonado`.
- Flujo Bizum: solicitud `enviada` con código y ningún dato personal en la URL de WhatsApp.
- Metadatos de la sesión de Stripe: solo `solicitud_id`.
- `/season-2` y la home generan el mismo HTML que antes, salvo el origen de los datos.

**PARA.**

---

## FASE 3 · Panel de administración (núcleo)

Objetivo: login seguro y las pantallas para operar el día a día.

1. Better Auth con email, contraseña y TOTP obligatorio. Sesión en cookie HttpOnly, Secure, SameSite=Strict, 12 h. Bloqueo tras 5 intentos fallidos en 15 min. Un script `db/crear-admin.mjs` crea a John como propietario.
2. `/admin`: páginas Astro sin datos; todo se pide a `/api/admin/*`, que comprueba sesión y rol. Las acciones son POST y exigen Origin `raceupkc.com`. Diseño pensado primero para el móvil.
3. Pantallas: Hoy, Leads (con F3 Nuevo lead), Recuperar, Personas (ficha 360, fusión de duplicados), Rondas (interruptores de cupo, aplazar, lista para el circuito, cobro en circuito), Inscripciones, Ventas y pagos (F4 Nueva venta, registrar pago, confirmar o rechazar Bizum, anotar número de factura), Ajustes (entidad cobradora, historial).
4. Cada lista: filtros combinables con Y, vistas guardadas (`vista_guardada`) y exportación a CSV y XLSX de lo que se ve. Sin columnas sensibles salvo casilla + confirmación, que queda registrada en `evento`.
5. Botones "Enviar por WhatsApp": abren `wa.me` con el teléfono del piloto y un mensaje preparado, y registran la interacción. Los textos van en un único archivo de mensajes, fácil de editar.
6. Cabeceras de no indexación de la regla 8, en `vercel.json`.

**Verificación**
- Sin TOTP no se entra; con 5 fallos se bloquea.
- Cualquier `/api/admin/*` sin sesión devuelve 401.
- `curl -I` a `/admin` y `/api/admin/...` muestra `X-Robots-Tag: noindex, nofollow`.
- F3: un lead con teléfono existente abre la ficha en vez de duplicar.
- F4: venta de temporada completa a un piloto pagada por otra persona, con 2 pagos (Bizum pendiente + efectivo). Las inscripciones y los saldos son correctos y, al confirmar el Bizum, cambian de estado solas.
- Cobro en circuito: 69 € en efectivo pasan una inscripción de `reservada` a `pagada` en un toque.
- La exportación XLSX de inscripciones abre en Excel y Google Sheets y no lleva DNI ni peso.

**PARA.**

---

## FASE 4 · Onboarding y grupo de WhatsApp

Objetivo: flujo F5 completo.

1. `/onboarding/[token]`: token de 32 bytes, solo su hash en la base de datos. Sin indexar, sin píxel y con `Referrer-Policy: no-referrer`. Cada paso se autoguarda en `onboarding.borrador`.
2. Pasos en este orden: datos personales → tutor (solo si es menor de 18) → perfil (nombre de competición propuesto, dorsal entre los libres, experiencia, frecuencia, opcionales) → datos físicos (consentimiento de peso, peso, categoría calculada con `regla_categoria`; en la franja el piloto elige según `franja_ambas_categorias`) → emergencia → foto (se puede saltar) → formación (solo si hay módulos activos) → documentos al final (reglamento, cesión de imagen con web, redes y anuncios por separado; anuncios oculto si es menor; asunción de riesgos con nombre y DNI).
3. DNI cifrado con AES-256-GCM (`RUKC_DATA_KEY`), guardando solo los 3 últimos caracteres en claro.
4. Fotos al Blob privado mediante subida autenticada; se sirven por una función que comprueba permiso.
5. Cada documento aceptado crea una fila en `aceptacion` con versión, hash, IP, user agent, firmante y contexto.
6. Al completar: `acceso_grupo` a `pendiente_aprobacion`. En el panel, la pantalla "Onboarding y grupo" permite aprobar o rechazar (con motivo), enviar el enlace y marcar dentro. El enlace del grupo solo se muestra al piloto cuando está aprobado.
7. Aviso en el panel si un piloto no llega a la edad mínima de algún circuito donde está inscrito.
8. Acreditación (pantalla Rondas): marcar `asistio` exige onboarding completado, o un motivo de excepción.

**Verificación**
- Adulto completa el onboarding: aceptaciones correctas y DNI ilegible en la tabla.
- Menor de 18: no se completa sin tutor y la casilla de anuncios no aparece.
- Enlace con token falso: 404 sin pistas.
- La foto no se puede abrir sin permiso.
- Marcar asistió sin onboarding pide motivo.

**PARA.**

---

## FASE 5 · Feedback post-carrera

Objetivo: flujo F6 completo.

1. Editor de plantillas en el panel. Una plantilla usada no se edita: se duplica como versión nueva.
2. "Generar feedback" en una ronda celebrada: un envío por cada inscripción en `asistio`, caducidad de 14 días.
3. `/feedback/[token]`: mismas protecciones que el onboarding. Marca `abierto` al cargar y `respondido` al enviar; guarda una fila por pregunta.
4. Pantalla Feedback: contadores por estado, botón de envío y de recordatorio por piloto, filtros por respuesta y exportación.

**Verificación**
- Ronda de prueba con 3 asistentes: 3 envíos. Responde uno, abre otro sin responder, deja el tercero: los contadores cuadran.
- Filtro "nota menor de 7" devuelve solo lo que corresponde.
- Un enlace caducado ya no acepta respuestas.

**PARA.**

---

## FASE 6 · Operación: traslados, cancelaciones, reembolsos, créditos, tareas y RGPD

1. F7 Traslado: con menos de 14 días pide motivo; mueve los pagos aplicados.
2. F8 Cancelación de ronda: inscripciones a `cancelada` con resolución `pendiente`, y resolución por piloto (reembolso, crédito o traslado).
3. Reembolsos: por la API de Stripe si el pago fue por Stripe; registro manual si no.
4. Créditos: abonos y canjes manuales desde la ficha; el canje cuenta para el saldo de la inscripción.
5. Tareas programadas (Vercel Cron, UTC, con `CRON_SECRET`):
    1. Cada hora: Bizum sin confirmar en 72 h a `pago_abandonado`, y feedback caducado.
    2. Diaria 03:00: copia de todas las tablas a JSON comprimido y cifrado en Blob privado; conserva 30 diarias y 12 mensuales.
    3. Diaria: consumo de Neon del mes, con aviso en el panel al pasar el 70 %.
    4. Mensual: lista de personas con plazo de conservación vencido para que John confirme la anonimización.
6. Pantallas Documentos (versiones, fecha de revisión del abogado, activar) y RGPD (solicitudes con plazo de un mes, exportar todo lo de una persona, anonimizar).
7. Una tarea programada nunca reintenta sola: si falla, deja el error en `evento` y aviso en el panel.

**Verificación**
- Traslado fuera de plazo sin motivo: rechazado. Con motivo: los pagos se mueven y los saldos cuadran.
- Cancelar una ronda de prueba con 2 inscritos; resolver uno con reembolso de Stripe en modo test y otro con crédito. Revisa el libro de créditos y los estados.
- Ejecuta a mano cada tarea programada con `CRON_SECRET` y enseña el resultado.
- Restaura la copia de seguridad en una rama nueva de Neon y compara los conteos por tabla.

**PARA.**

---

## FASE 7 · Paso a producción

1. Dame una lista de comprobación previa para que la complete yo:
    1. Rama principal de Neon con los dos roles.
    2. Variables de producción en Vercel.
    3. Almacén Blob privado de producción.
    4. Eventos del webhook de Stripe en producción (añadir `checkout.session.expired` y `checkout.session.async_payment_failed`).
    5. Acuerdos de encargado de tratamiento aceptados en Neon y Vercel.
    6. Textos legales revisados y activados.
    7. Política de privacidad actualizada.
2. Plan de despliegue con vuelta atrás: el webhook nuevo y el formulario se activan juntos; si algo falla, se vuelve al despliegue anterior en Vercel y la base de datos se queda como está.
3. Prueba real guiada: John hace una reserva de 30 € con su tarjeta, comprobamos todo el recorrido y la reembolsamos desde el panel.

**Verificación**
- Reserva real visible en el panel con su atribución.
- Onboarding real completado.
- Reembolso real reflejado en Stripe y en la base de datos.
- Búsqueda `site:raceupkc.com/admin` y `site:raceupkc.com/onboarding` sin resultados, y cabeceras correctas.

**PARA. Fin del prompt maestro.**
