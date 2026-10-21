# RUKC · raceupkc.com

Web de RaceUp Karting Championship: home con hero animado, Temporada 2 (calendario, resultados y clasificaciones desde Google Sheets), reglamento, textos legales y la landing oculta de los anuncios de Meta.

Hecha con [Astro](https://astro.build) (web estática), GSAP + ScrollTrigger y Lenis. Se publica en Vercel.

| Ruta | Qué es |
|---|---|
| `/` | Home |
| `/season-2` | Calendario, clasificación de Ligeros y Pesados, rondas, menciones y penalizaciones |
| `/season-2/r1-karting-mijas`… | Resultado de cada ronda disputada (se crean solas) |
| `/reglamento` | Reglamento deportivo (generado desde el .docx) |
| `/aviso-legal`, `/privacidad`, `/cookies` | Textos legales |
| `/acceso-t2-c7e594` | Landing de anuncios: oculta, con noindex, fuera del sitemap y sin enlaces internos |

---

## 1. Actualizar los resultados después de cada carrera

Todo sale de **una sola hoja de Google Sheets**. No hay que tocar código: los puntos, la clasificación de la ronda, la general de cada categoría, las menciones automáticas y el calendario se calculan solos.

1. Abre la hoja de la temporada.
2. Rellena la pestaña **Resultados**: una fila por piloto y ronda.
   - `ronda`, `dorsal` y `posicion` (puedes poner la de la clasificación conjunta: la web la recalcula dentro de cada categoría).
   - Marca con `x` lo que toque: `pole`, `vuelta_rapida`, `constancia`, `pierde_bonus`, `dsq`.
   - `finaliza`: déjalo vacío si terminó; pon `no` si no completó el 80 % de las vueltas.
   - `salida` (opcional) activa la mención "Mayor remontada".
3. Si un piloto es nuevo, añádelo antes en **Pilotos** (dorsal, nombre público y categoría).
4. Si hubo sanciones con puntos de penalización, añádelas en **Sanciones**. Menciones como "Piloto del día", en **Menciones**.
5. Si la final se paró con bandera roja, pon en **Rondas** la columna `carrera` en `mitad` o `nula`.
6. Menú **RUKC → Publicar web**. En uno o dos minutos la web está actualizada.

**Si algo está mal en la hoja**, la web **no** se actualiza y la versión anterior sigue online. En Vercel (proyecto → Deployments → el último, en rojo) verás el error exacto, por ejemplo:

```
La hoja de la temporada tiene errores:
- Resultados, fila 7: el dorsal "99" no está en la pestaña Pilotos
```

Corrígelo y vuelve a pulsar **Publicar web**.

> La hoja es visible para cualquiera con el enlace: **nunca** pongas pesos, teléfonos ni correos.

### Fotos y vídeos de cada ronda

Cada ronda disputada tiene una galería en su página (`/season-2/r1-karting-mijas`…). Las fotos se quedan en tu Google Drive; la web solo las enlaza.

1. En Google Drive, crea una carpeta por ronda (por ejemplo "RUKC T2 · R1 Mijas") y sube ahí las fotos y vídeos. Puede tener subcarpetas. Mejor JPG que RAW (.dng) o HEIC.
2. Compártela: **Compartir → Cualquier persona con el enlace → Lector**.
3. En la hoja, pestaña **Rondas**, columna `fotos`: pega el enlace de la carpeta.
4. Opcional, columna `videos`: enlaces de YouTube (vídeos sueltos o listas de reproducción), separados por espacios. Para vídeos largos (resúmenes, on-boards) YouTube va mucho mejor que Drive.
5. **RUKC → Publicar web.** El botón recorre las carpetas, escribe la lista en la pestaña **Media** y publica. Si una carpeta no está compartida, te avisa antes.

La galería carga 24 miniaturas y el resto con "Ver más"; el visor tiene flechas, deslizar en móvil y botón **Descargar**. Las miniaturas se sirven desde Google (`lh3.googleusercontent.com`) a tamaño reducido, así que no gastan tráfico de Vercel. Si algún día el tráfico creciera mucho y Google limitara las imágenes, la alternativa es un servicio de imágenes (Cloudinary o similar).

### Reglas que aplica la web (reglamento v1.1)

- Puntos por posición en la categoría (Art. 46): 25-20-16-13-11-10-9-8-7-6-5-4-3-2-1 del 1.º al 15.º y 1 punto del 16.º en adelante; solo puntúa quien finaliza. Si el reglamento cambia la escala, actualiza `PUNTOS_POSICION` y `PUNTOS_FINALIZAR` en `src/lib/season/points.ts`: un test avisa si la web y la tabla del reglamento no coinciden.
- Bonus: pole +2, vuelta rápida +2, constancia +3 (Art. 47); se pierden con `pierde_bonus` (Art. 23 quinquies).
- Bandera roja: `mitad` = mitad de puntos sin vuelta rápida ni constancia; `nula` = no puntúa (Art. 31 quater).
- Descarte de la peor ronda al final de la temporada; una ronda con DSQ no se descarta (Art. 48). Pestaña **Config**, `descarte`: `auto`, `si` o `no`.
- Desempates del Art. 49. Puntos de penalización de los últimos 12 meses (Art. 45).

El cálculo está en `src/lib/season/points.ts` y lo comprueban los tests (`npm test`).

### Conectar la hoja por primera vez

1. Sube a tu Google Drive `tools/sheet/RUKC-Temporada-2.xlsx` (ya trae el calendario, las listas desplegables y una pestaña de instrucciones).
2. Ábrelo y usa **Archivo → Guardar como Hojas de cálculo de Google**. Trabaja siempre sobre esa copia.
3. **Compartir → Cualquier persona con el enlace → Lector.**
4. Copia el ID de la URL: `https://docs.google.com/spreadsheets/d/`**`ESTE_ID`**`/edit`.
5. En Vercel: proyecto **raceupkc → Settings → Environment Variables** → `RUKC_SHEET_ID` = ese ID (Production y Preview). Vuelve a desplegar.
6. Botón **Publicar web**:
   - En Vercel: **Settings → Git → Deploy Hooks** → crea uno (nombre "Hoja", rama `main`) y copia su URL.
   - En la hoja: **Extensiones → Apps Script**, pega el contenido de `tools/sheet/publicar.gs` y guarda.
   - En Apps Script: **Configuración del proyecto → Propiedades del script** → `DEPLOY_HOOK_URL` = la URL del hook.
   - Recarga la hoja: aparece el menú **RUKC**.

Mientras `RUKC_SHEET_ID` no esté puesto, la web usa los datos de ejemplo de `data/demo/` y muestra un aviso **DEMO**.

---

## 2. Cambiar el slug de la landing

El slug actual es `acceso-t2-c7e594` → `https://raceupkc.com/acceso-t2-c7e594`.

1. Cámbialo en `src/config/landing.ts` (`slug`).
2. Cámbialo también en `vercel.json`, en la regla que pone la cabecera `X-Robots-Tag: noindex, nofollow`.
3. `npm test` comprueba que los dos coinciden y que ninguna página enlaza a la landing.
4. Despliega y **actualiza la URL de destino en los anuncios de Meta**. El slug antiguo dejará de existir (404).

Los textos de la landing están en `src/landing/landing.html`. Arriba del archivo, en `window.RUKC`, están las plazas totales y ocupadas, el precio y el mensaje de WhatsApp.

---

## 3. Pixel de Meta y API de conversiones

- **Pixel ID**: `src/config/landing.ts` → `pixelId` (ahora `1960101698031451`).
- **CAPI**: la función `api/lead.js` envía el evento `Lead` del formulario con email y teléfono cifrados (SHA-256) y el mismo `eventID` que el Pixel, para que Meta no lo duplique. Necesita en Vercel la variable `META_CAPI_TOKEN` (token de acceso de la API de conversiones, en el Administrador de eventos de Meta).
- Eventos: `PageView` al entrar y `Lead` al enviar el formulario (después se abre WhatsApp).
- Banner de cookies con **Aceptar** y **Rechazar**. El Pixel se carga al entrar (1,5 s después de la carga o con la primera interacción, para no frenar la página). Si el usuario pulsa **Rechazar**, se revoca el consentimiento (`fbq('consent','revoke')`): no se envían más eventos, ni el `Lead`, ni la llamada a CAPI, tampoco en visitas posteriores.
- Comprobarlo: `node tools/qa/pixel-check.mjs https://raceupkc.com/acceso-t2-c7e594` lista los eventos que salen en la red con Aceptar y con Rechazar.

La web principal no carga el Pixel ni usa cookies.

---

## 4. Deploy

El repositorio está conectado al proyecto **raceupkc** de Vercel: cada `git push` a `main` publica en producción y cada rama genera una URL de prueba.

Variables de entorno en Vercel:

| Variable | Para qué |
|---|---|
| `RUKC_SHEET_ID` | ID de la hoja de la temporada |
| `META_CAPI_TOKEN` | Token de la API de conversiones de Meta |
| `META_PIXEL_ID` | Opcional. Si no está, `api/lead.js` usa el del código |

Deploy manual desde tu equipo (si hiciera falta):

```bash
npx vercel deploy
```

```bash
npx vercel deploy --prod
```

---

## 5. Trabajar en local

```bash
npm ci
```

```bash
npm run dev
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Web en http://localhost:4321 con recarga automática |
| `npm run build` | Genera la web en `dist/` (lee la hoja si `RUKC_SHEET_ID` está definida) |
| `npm test` | Tests del cálculo de puntos, del lector de la hoja y de la landing oculta |
| `npm run reglamento` | Regenera `/reglamento` desde el .docx de `tools/reglamento/` |
| `npm run hero:render` / `npm run hero:encode` | Vuelve a generar los frames del hero |

Para probar con la hoja real en local, crea un archivo `.env` con `RUKC_SHEET_ID=...` (no se sube al repositorio).

### Actualizar el reglamento

Sustituye el `.docx` de `tools/reglamento/` por la versión nueva y ejecuta `npm run reglamento`. El conversor corrige el calendario del Art. 70 (R5 en Kart&Fun Málaga, R7 en Mijas) porque la v1.1 lo tiene cambiado; cuando el .docx venga corregido, quita esa corrección de `tools/reglamento/convert.mjs`.

### Regenerar el hero

La animación es una secuencia de frames renderizada con Three.js (`tools/hero/scene.js` y `tools/hero/kart.js`) y controlada por el scroll.

1. `npm run hero:render`: abre la escena en Chrome sin ventana y guarda los frames (escritorio 1920×1080, 220 frames; móvil 600×1240, 150 frames) y la posición en pantalla de cada pieza señalada.
2. `npm run hero:encode`: los convierte a WebP en `public/hero/` y escribe `manifest.json` y `anchors-*.json`.

Los tiempos de cada fase (`CUES` en `scene.js`) se copian al manifest, y los textos de `src/components/Hero.astro` los usan para entrar y salir a la vez que la escena.

### QA

- `node tools/qa/hero-qa.mjs <url> <carpeta>`: capturas del hero a 1440 y 390 px y fps durante el scroll (móvil con la CPU ralentizada x4).
- `node tools/qa/page-shots.mjs <url> <carpeta>`: capturas por secciones y aviso si hay scroll horizontal.
- `qa/`: capturas de cada fase del proyecto.

---

## Estructura

```
src/
  pages/            rutas (home, season-2, reglamento, legales, landing, sitemap.xml)
  components/       Header, Footer, Hero, secciones de la home y de la temporada
  lib/season/       lectura de la hoja (load.ts), puntos (points.ts), tipos y formato
  landing/          HTML de la landing de anuncios
  config/           site.ts (WhatsApp, Instagram, email) y landing.ts (slug y Pixel)
  content/          reglamento generado
api/lead.js         función de Vercel para la API de conversiones de Meta
data/demo/          datos DEMO de la temporada
public/hero/        frames del hero
tools/              hero, plantilla de la hoja, reglamento y QA
tests/              tests (npm test)
```
