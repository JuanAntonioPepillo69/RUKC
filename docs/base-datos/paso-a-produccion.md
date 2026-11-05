# Paso a producción (fase 7)

Estado a 4 de noviembre de 2026. Lo que queda por hacer en cada punto se comprueba con `npm run db:comprobar`, que lee `.env.produccion` (archivo local, fuera de git) y solo hace lecturas: no escribe en la base de datos, ni en Stripe, ni en Blob, y no muestra ningún secreto.

Cómo está hoy:

- raceupkc.com sirve el despliegue `raceupkc-bs87s83gj` (30 oct), hecho desde `main`. Es el punto de vuelta atrás.
- Vercel publica producción cada vez que entra algo en `main` en GitHub. El botón "Publicar web" de la hoja también construye `main`.
- Neon, rama principal `production`: ya tiene los roles `rukc_app` y `rukc_migraciones`, y las 9 migraciones están pendientes. La web actual no usa la base de datos, así que se puede preparar sin que se note.
- Vercel Production solo tiene `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RUKC_SHEET_ID` y `META_CAPI_TOKEN`.
- Las funciones pasan a Fráncfort (`fra1`), junto a Neon. Era una petición del diseño ("fijar región UE"), y la tarea diaria ha bajado de unos 1000 ms a unos 40 ms por consulta.

### Avance (4 de noviembre de 2026, tarde)

`npm run db:comprobar`: 41 OK, 0 FALTA. Quedan 3 REVISAR que solo se pueden ver a mano o después del despliegue: los permisos de escritura de Stripe, los eventos del webhook y el Blob.

- **Hecho:**
  - puntos 1, 1b y 1c: 9 migraciones, la T2 y los 4 textos del reglamento v1.1, con el mismo hash que en desarrollo;
  - punto 2: claves nuevas generadas, copia de las dos de cifrado en el gestor de John y 8 variables subidas a Vercel Production;
  - punto 3: almacén `rukc-produccion`, privado, en fra1 y solo en Production;
  - punto 4: John añadió los dos eventos al webhook;
  - punto 4b: clave restringida `raceupkc-web`, guardada en `.env.produccion` y en Vercel Production;
  - punto 9: administrador propietario creado; el TOTP se activa en el primer acceso.
- **Pendiente:**
  - puntos 5, 6 y 7: DPA, aviso de borradores y política de privacidad;
  - punto 8: **hecho el 5-11-2026**, 11 reservas de Stripe y 8 Bizum (ver decisiones.md);
  - punto 10: registro de actividades.

## 1. Lista de comprobación previa

Nadie pega secretos en el chat. Los valores van a `.env.produccion` y a Vercel.

| # | Qué | Quién | Cómo | Se comprueba con |
| --- | --- | --- | --- | --- |
| 1 | Rama principal de Neon con los dos roles | Hecho | Los roles ya existen en `production`. | `db:comprobar`: "Neon: rol …" |
| 1b | Cadenas de conexión de producción | John | Neon → rama `production` → Connect. Copia `rukc_app` con pooling en `DATABASE_URL` y `rukc_migraciones` sin pooling en `DATABASE_URL_MIGRACIONES`. Pégalas en `.env.produccion`. | "Neon: rama de … (principal)" |
| 1c | Migrar, cargar la T2 y los textos legales en producción | Claude, con tu OK | `node --env-file=.env.produccion db/migrar.mjs`, luego `db/sembrar.mjs` y `db/documentos-reglamento.mjs` | "Migraciones", "Temporada", "Documento vigente" |
| 2 | Variables de producción en Vercel | Claude genera, John guarda copia | Claves nuevas, distintas de las de desarrollo: `RUKC_DATA_KEY`, `RUKC_BACKUP_KEY`, `BETTER_AUTH_SECRET` y `CRON_SECRET`. Las de `RUKC_DATA_KEY` y `RUKC_BACKUP_KEY` se guardan también en tu gestor de contraseñas: sin ellas no se pueden leer los DNI ni las copias. Añade además `BETTER_AUTH_URL=https://raceupkc.com`, `DATABASE_URL`, `NEON_API_KEY` y `NEON_PROJECT_ID`. No van a Vercel: `DATABASE_URL_MIGRACIONES`, `RUKC_ENTORNO` ni `RUKC_BLOB_LOCAL_DIR`. | Todas las líneas "Variable …" |
| 3 | Almacén Blob privado de producción | John | Vercel → Storage → Create → Blob, nombre `rukc-produccion`, acceso **Private** y región **Frankfurt (fra1)**. Conéctalo solo a **Production**, marcando "Add a read-write token env var". | Después del despliegue: copia del día en Ajustes |
| 4 | Webhook de Stripe en producción | John | Stripe en modo live → Developers → Webhooks → endpoint `https://raceupkc.com/api/stripe-webhook` → añade `checkout.session.expired` y `checkout.session.async_payment_failed`. Ya puede hacerse: el webhook actual responde 200 a los eventos que no usa. | "Stripe: eventos del webhook" |
| 4b | Permisos de la clave de Stripe | John | Si es restringida (`rk_live_`): Checkout Sessions y Refunds en **Write**; PaymentIntents y Charges en **Read**. Si cambias la clave, actualiza `STRIPE_SECRET_KEY` en Production y en `.env.produccion`. | "Stripe: permiso …" |
| 5 | Acuerdos de encargado del tratamiento (DPA) de Neon y Vercel | John | En la web legal de cada proveedor. En unos va incluido en los términos y en otros se acepta aparte. Guarda la fecha y una copia. | A mano |
| 6 | Textos legales revisados y activados | John y su abogado | Los 4 del reglamento v1.1 ya están revisados (4-11-2026) y se cargan en el paso 1c. **Falta el aviso de borradores** del formulario: hoy sale con la etiqueta "Texto provisional". Cuando el abogado dé el texto, se carga como documento `aviso_borradores` con su fecha de revisión. | "Documento vigente"; en /inscripcion ya no sale "Texto provisional" |
| 7 | Política de privacidad actualizada | John y su abogado | El abogado la redacta con los datos de la sección 4. Claude la pone en /privacidad tal cual, en el mismo despliegue. | A mano |
| 8 | Reservas de la T2 ya cobradas (D4) | John da los datos, Claude importa | CSV de pagos exportado de Stripe y lista de los Bizum. Se importa antes de abrir el formulario; si no, el cupo de plazas sale mal. | Plazas por ronda en Hoy |
| 9 | Administrador de producción | John | En tu terminal: `node --env-file=.env.produccion db/crear-admin.mjs --email raceupkc@gmail.com --nombre "John"`. La contraseña la escribes tú. El TOTP se activa en el primer acceso a raceupkc.com/admin. | "Administrador propietario" |
| 10 | Registro de actividades de tratamiento | John y su abogado | Lo pide el diseño. Le sirve la sección 4. | A mano |

La lista está completa cuando `npm run db:comprobar` termina con `0 FALTA` y los puntos 5, 6, 7 y 10 están hechos.

## 2. Plan de despliegue con vuelta atrás

**Antes del día D (la web actual no cambia):** puntos 1 a 4, 8 y 9 de la lista. La base de datos de producción ya puede tener datos, porque la web actual no la lee.

**Día D (unos 20 minutos, con John delante):**

1. `npm run db:comprobar` → `0 FALTA`.
2. Apunta el despliegue actual: `raceupkc-bs87s83gj`, o el que esté en Vercel → Deployments → Production.
3. Con el OK de John: fusionar `bd/fase-7-produccion` en `main` y subirlo. Vercel construye producción, y en ese momento entran a la vez el formulario nuevo, el webhook nuevo, el panel y la tarea diaria.
4. Pruebas de humo, en los primeros 5 minutos:
   - `/` y `/season-2` se ven como antes;
   - `/inscripcion` carga las rondas y los precios, sin "Texto provisional";
   - `/admin` pide contraseña y TOTP;
   - `/api/cron` sin clave → 401;
   - cabeceras `noindex` y `no-referrer` en /admin, /onboarding, /feedback y /api.
5. Tarea diaria a mano con `CRON_SECRET`: la copia se guarda en el Blob de producción y el consumo de Neon aparece.
6. Prueba real guiada (sección 3).

**Cuándo se vuelve atrás:**
- el formulario no carga o el pago no se puede iniciar;
- Stripe marca errores 4xx/5xx en el webhook;
- no se puede entrar al panel.

**Cómo se vuelve atrás:**

1. Vercel → Deployments → `raceupkc-bs87s83gj` → **Instant Rollback**. Tarda segundos.
2. La base de datos se queda como está: no se borra ni se revierte nada.
3. En `main`, un commit que revierta la fusión (`git revert -m 1 <fusión>`) y subirlo. Así el botón "Publicar web" de la hoja no vuelve a publicar la versión nueva.
4. Tras un Instant Rollback, Vercel puede dejar de promocionar solo los despliegues nuevos hasta que se deshaga en Deployments. Hay que revisarlo cuando se arregle el fallo.
5. Los pagos hechos mientras estuvo la versión nueva quedan en Stripe y en la base de datos. Si sus avisos llegan al webhook antiguo, este solo envía el evento a Meta. Se revisan a mano en el panel cuando se vuelva a publicar.

## 3. Prueba real guiada

| Paso | Qué hace John | Qué comprobamos |
| --- | --- | --- |
| 1 | Abre `https://raceupkc.com/inscripcion?utm_source=prueba-fase7&utm_medium=manual&utm_campaign=paso-produccion` | El formulario carga y los borradores se guardan |
| 2 | Reserva 30 € con su tarjeta. Claude no introduce datos de tarjeta | Página de confirmación; pago en Stripe (live) con metadata solo de códigos |
| 3 | Abre el panel → Hoy y Ventas | Inscripción y pago confirmados por el webhook; **atribución** con `utm_source=prueba-fase7`; evento en `stripe_evento` |
| 4 | En la ficha: enviar el enlace de onboarding por WhatsApp y completarlo con sus datos | Onboarding `completo`; documentos aceptados con su hash; foto en el Blob de producción; DNI cifrado |
| 5 | En la ficha: **Reembolsar** 30 € y resolver la inscripción | Reembolso `emitido` en la base de datos y visible en Stripe |
| 6 | Busca en Google `site:raceupkc.com/admin` y `site:raceupkc.com/onboarding` | Sin resultados; robots.txt con Disallow; sitemap sin rutas privadas; cabeceras correctas |
| 7 | Al día siguiente, Ajustes → Tareas y copias | La tarea de las 03:00–03:59 UTC está en ok y la copia del día aparece |

## 4. Datos para el abogado (política de privacidad y registro de actividades)

Estos son hechos del sistema, no texto legal.

- **Responsable:** RUKC, raceupkc@gmail.com.
- **Encargados del tratamiento:**
  - Neon: base de datos, UE, Fráncfort;
  - Vercel: alojamiento, funciones en Fráncfort (`fra1`) y archivos (Blob privado, Fráncfort);
  - Stripe: pagos;
  - Meta: API de conversiones, para medir anuncios;
  - Google: la hoja de la temporada, sin datos de personas.
  - Los mensajes de WhatsApp se envían a mano desde el teléfono de RUKC.
- **Datos:**
  - de quien reserva y paga: nombre, teléfono, email, importes;
  - borradores del formulario, guardados antes de pagar;
  - atribución de la visita: UTM, fbclid, página de llegada;
  - del piloto: fecha de nacimiento, DNI/NIE/pasaporte cifrado (solo se ven los 3 últimos caracteres), peso con consentimiento aparte y revocable, foto, contacto de emergencia (un tercero), tutor si es menor;
  - firmas de reglamento, riesgos e imagen, con versión y hash;
  - respuestas al feedback.
- **Menores:** por debajo de 14 años consiente el tutor; por debajo de 18, el tutor firma la asunción de riesgos. La casilla de imagen en anuncios no aparece para menores.
- **Plazos:** según la tabla del diseño. Personas sin actividad durante 12 meses: aviso mensual en el panel y anonimización confirmada por John; los importes se conservan para la contabilidad (6 años).
- **Copias de seguridad:** diarias y cifradas. Se guardan 30 diarias y 12 mensuales, así que los datos anonimizados o borrados pueden seguir hasta 12 meses en las copias.
- **Derechos:** cada solicitud entra en el panel con plazo de un mes. Exportación de todos los datos de una persona (acceso y portabilidad) y anonimización (supresión).
