---
name: post-carrera-rukc
description: Genera los posts de Instagram post-carrera de RUKC (RaceUp Karting Championship, @rukc2026) a partir de una carpeta de carrera con fotos y clips. Por defecto hace tres posts por ronda, una fila completa de la cuadrícula del perfil: un carrusel por categoría (Ligeros y Pesados) y uno de "Destacados" con fotos a pantalla completa y clips de vídeo 4:5. Saca resultados y clasificación de raceupkc.com, elige las fotos y los clips, renderiza las slides 1080x1350 con el sistema visual "Tribuna" (negro y oro) y escribe la descripción de cada post. Úsala siempre que el usuario hable de publicar, preparar o maquetar el post, carrusel, resultados, destacados o podio de una ronda de RUKC o de la liga de karting, o cuando suelte una carpeta nueva de Pictures\Carreras, aunque no nombre la skill.
---

# Posts post-carrera RUKC

Convierte una carpeta de carrera (`Pictures\Carreras\AAAA-MM-DD_RN_Circuito\`) en tres posts, uno por fila de la cuadrícula del perfil. Las carpetas van numeradas **en el orden de publicación**:

```
salida/1-pesados/     01_portada.png … 08_proxima.png + descripcion.txt
salida/2-destacados/  01_portada.png, NN_foto.jpg, NN_clip.mp4 + descripcion.txt
salida/3-ligeros/     01_portada.png … 08_proxima.png + descripcion.txt
```

Instagram pone arriba a la izquierda lo último publicado, así que publicando 1 → 2 → 3 la fila del perfil se lee **Ligeros | Destacados | Pesados**: oro, blanco y rojo, simétrica y en el orden en que se corrió.

Sin bloque `destacados` en `carrusel.json` salen solo los dos posts de categoría (`1-pesados`, `2-ligeros`). Con `"modo": "unico"` sale un solo post con las dos categorías, directamente en `salida/`.

El sistema visual está cerrado, así que no hay que rediseñar nada: tu trabajo es reunir los datos, elegir fotos y clips, generar, revisar y avisar de lo que falte.

Todo lo de esta skill vive en su propia carpeta (`<skill>` a partir de ahora): `scripts/`, `slides/`, `sistema.css`, `calendario.json`, `fonts/` y `marca/`. Los scripts son Node y usan el Chrome instalado (Playwright con `channel: 'chrome'`). Si falta `<skill>/node_modules`, ejecuta `npm install` en `<skill>`. Los clips necesitan ffmpeg: el generador lo busca en la variable `FFMPEG`, en el PATH y en la instalación de winget (`Gyan.FFmpeg`); si no está, se instala con `winget install Gyan.FFmpeg`.

`MANUAL.md` (en `<skill>`) es la guía para el usuario. Si pregunta cómo se usa esto, remítele a ese archivo.

## Reglas que no se negocian

Están para proteger la credibilidad de la liga, que es justo el objetivo de estos posts.

- **Datos solo de la fuente.** Nombres, posiciones, tiempos y puntos salen de `datos/ronda.json`, que se descarga de raceupkc.com. No calcules ni completes nada a mano, ni corrijas erratas de nombres: si ves una posible errata, avísala para que la corrijan en la web. Si un dato falta, el generador pinta un hueco rayado con el texto "FALTA DATO" y lo lista en AVISOS. Díselo al usuario.
- **Originales intactos.** Los scripts solo leen fotos y vídeos. No muevas, edites, renombres ni borres fotos o vídeos. Si el usuario te pasa fotos (por el chat, WeTransfer o Descargas), crea copias en `<carpeta>/podios/`.
- **Sin emojis** en ninguna slide ni en la descripción. **Nunca hables de precio** ni de "minutos de pista": RUKC se vende como competición, no como alquiler.
- **Ningún texto por debajo de 28 px.** El generador lo comprueba solo.

## Flujo

### 1. Datos de la ronda

Saca el número de ronda del nombre de la carpeta (`_R1_`). Si no aparece, pregúntalo.

```bash
node <skill>/scripts/datos-web.mjs "<carpeta>" <N>
```

El script escribe `<carpeta>/datos/ronda.json` con los resultados por categoría, la clasificación del campeonato y las menciones.

- Si la web no tiene publicada la ronda, el script sale con error. En ese caso para y pide al usuario que la publique o que te pase los datos.
- Si avisa de datos DEMO, no generes nada publicable.
- Los @ de Instagram de los pilotos no están en la web. Si el usuario los da, guárdalos en `<carpeta>/datos/instagram.json` con el formato `{ "38": "@usuario" }` (la clave es el dorsal). La descripción los etiquetará.

### 2. Fotos

**RAW del móvil (.dng).** Chrome no los lee. Revélalos a JPG en `podios/` y deja los DNG donde estén:

```bash
magick "<ruta>.dng" -auto-orient -resize 4000x4000\> -auto-level -sigmoidal-contrast 3x50% -modulate 100,115 -quality 90 "<carpeta>/podios/<nombre>.jpg"
```

El revelado por defecto sale apagado; estos ajustes le devuelven contraste y color.

```bash
node <skill>/scripts/hojas-contacto.mjs "<carpeta>"
```

El script agrupa las fotos en sesiones por hora EXIF y crea hojas de contacto en una carpeta temporal. Abre las hojas con Read.

- **Una sesión por categoría.** En RUKC cada categoría corre en su propia sesión. En la R1, Ligeros fue por la mañana, con luz clara, y Pesados por la tarde-noche, más oscura. Las sesiones pequeñas entre medias suelen ser público o descansos. Si no está claro qué sesión es cada categoría, pregunta.
- **Fotos sin hora.** Las fotos enviadas por WhatsApp o convertidas no tienen hora y salen como una sesión aparte. Suelen ser las fotos de grupo y de podio: míralas y asígnalas por la luz (día u ocaso) y por las caras.

Rellena `<carpeta>/carrusel.json` con el formato de `references/carrusel.md`. Criterios de elección:

- **Portada de categoría:** la foto de grupo de esa categoría, con caras visibles.
- **La carrera:** la foto de acción más potente de esa categoría, mejor con pelea entre varios karts.
- **Podio:** la foto del podio de esa categoría, con caras, diplomas y escudo de la bandera. Si el texto de la bandera queda cortado a medias, encuadra para que no salga.
- **Próxima ronda (común a los dos posts):** una foto de ambiente (atardecer, circuito).
- **Destacados, portada:** una foto horizontal de acción con caras (dos karts juntos funciona muy bien), distinta de las de "La carrera".
- **Destacados, fotos (8-12):** a pantalla completa, sin texto. Mezcla primeros planos de pilotos, peleas entre karts, la salida con bandera y la parrilla, de las dos categorías (Ligeros primero, Pesados después). Ojo con el recorte: de una foto horizontal 3:2 solo se ve algo más de la mitad central del ancho; lleva el `foco` a lo importante. Las verticales casi no se recortan.
- **Descarta siempre:** fotos movidas o desenfocadas, caras cortadas, retratos de público que no sean pilotos y fotos casi repetidas.
- **No pongas nombres a las fotos.** El número del kart de alquiler no es el dorsal del piloto.

Las categorías ya no llevan slides de galería: las fotos sueltas van en Destacados.

### 3. Clips de vídeo (post de destacados)

2 o 3 clips de 5 a 10 s. Los clips del iPhone suelen ser 4K 60 fps HLG (HDR): el generador lo detecta y aplica el tonemap a SDR. Las cámaras onboard suelen ser ya SDR.

1. Localiza los vídeos: `<carpeta>/clips/` si existe; si no, pregunta dónde están (en la R1 estaban en `Videos\Clips`). Se referencian por ruta relativa a la carpeta de la carrera o absoluta.
2. Para buscar momentos, saca una tira de fotogramas de cada vídeo candidato (sin tocar el original) y ábrela con Read:
   ```bash
   ffmpeg -v error -ss <inicio> -t <segundos> -i "<video>" -vf "fps=1,scale=640:-2,tile=3x3:padding=4" -frames:v 1 "<tmp>/tira.jpg"
   ```
   Busca pelea: dos o tres karts juntos, un adelantamiento, una curva con varios karts. Evita tramos movidos o con la cámara apuntando al suelo o a la pierna del piloto.
3. Ponlos en `destacados.items` con `inicio`, `duracion` y `foco_x` (de 0 a 1: dónde está la acción en horizontal; el clip se recorta a 4:5 alrededor de ese punto, un 45 % del ancho de un vídeo 16:9).
4. El primer clip, en la posición 2 del carrusel (justo después de la portada): engancha a quien desliza.

Salida de cada clip: MP4 1080x1350 (4:5), 30 fps, H.264 + AAC, con el sonido original del motor bajado y fundido al principio y al final. Los cortes se guardan en `<carpeta>/datos/clips/` y no se vuelven a codificar si no cambian sus parámetros.

### 4. Generar

```bash
node <skill>/scripts/generar.mjs "<carpeta>"
```

Cada post de categoría (8 slides con dos páginas de resultados y dos de campeonato) sigue este orden:

1. Portada (foto de grupo, circuito y ganador)
2. La carrera (foto con pole, vuelta rápida y mayor remontada)
3. Podio
4. Resultados
5. Campeonato
6. Próxima ronda

El post de destacados: portada (chip blanco "Destacados", "Lo mejor de la ronda N" y los ganadores en una línea si caben) y después los `items` en su orden: fotos a sangre (JPG calidad 92) y clips (MP4).

- Las tablas se reparten en páginas de 10 filas como máximo, equilibradas (20 filas pasan a 10+10; 16 filas, a 8+8).
- La slide de próxima ronda sale sola del calendario de la temporada (`calendario.json`); tras la última ronda no se genera. Cuando la temporada cambie, actualiza ese archivo.
- El generador borra lo que generó antes en `salida/` (también las carpetas antiguas sin número) y nunca toca otros archivos.
- Imprime una lista de AVISOS: datos que faltan, textos recortados o pequeños, textos que pisan el pie, fotos o clips que no existen, número de fotos o clips fuera de lo previsto y más de 20 slides en un post.

### 5. Revisar cada imagen y cada clip antes de enseñarlos

```bash
node <skill>/scripts/revisar.mjs "<carpeta>"
```

El script monta las slides de 3 en 3 (los clips, con un fotograma de su mitad y la marca CLIP), simula cada portada como miniatura de la cuadrícula del perfil (recorte 3:4) y monta `fila-cuadricula.png`: las tres portadas como quedan en la fila del perfil, Ligeros | Destacados | Pesados. Abre todas las imágenes con Read y comprueba:

- **Portadas:** se entienden en un segundo (categoría, circuito y ganador) y siguen leyéndose en la miniatura recortada. La fila se ve equilibrada.
- **Encuadre:** ninguna cara ni ningún kart protagonista cortado de forma fea. Si los hay, ajusta `foco` y `zoom` (fotos) o `foco_x`, `inicio` y `duracion` (clips) en `carrusel.json`, o cambia la foto o el clip, y vuelve a generar.
- **Clips:** además del fotograma central, saca una tira de 6 fotogramas del MP4 generado y mírala: la acción tiene que estar dentro del recorte durante todo el clip.
  ```bash
  ffmpeg -v error -i "<carpeta>/salida/2-destacados/NN_clip.mp4" -vf "fps=1.2,scale=270:-2,tile=6x1:padding=4" -frames:v 1 "<tmp>/clip.jpg"
  ```
- **Avisos:** ningún solape y ningún AVISO pendiente sin explicar.

Si una miniatura parece rara (posterizada, por ejemplo), recorta esa zona de la imagen real antes de dar el fallo por bueno.

### 6. Descripción

`generar.mjs` escribe un `descripcion.txt` en la carpeta de cada post, solo con datos.

Posts de categoría:

1. El ganador de la categoría.
2. Un resumen de 2-3 frases: cómo ganó, la pole y la vuelta rápida, la mayor remontada y si alguien hizo podio también en la otra categoría.
3. El podio con @, solo si hay `instagram.json`.
4. La próxima ronda con fecha y circuito, y el CTA al link de la bio.
5. Entre 3 y 5 hashtags locales.

Post de destacados: "Lo mejor de la RN en <circuito>.", una frase con el ganador de cada categoría, la próxima ronda + "Inscripción en el link de la bio." y los hashtags.

Léelas y pule la redacción si hace falta, sin añadir datos que no estén en `ronda.json` y sin emojis, exclamaciones ni precios. El tono es de liga seria: frases cortas, hechos y nada de hype.

### 7. Entrega

Cuéntale al usuario:

- dónde están los tres posts y en qué orden publicarlos;
- el texto de cada descripción, listo para pegar;
- los AVISOS: datos que faltan, posibles erratas de nombres en la web, fotos dudosas y si no hay @ que etiquetar.

**Publicación y cuadrícula del perfil:**

- Publica en el orden de las carpetas: `1-pesados`, `2-destacados`, `3-ligeros`. Deja unas 3 o 4 horas entre uno y otro (o publica uno al día) para que no compitan entre sí.
- **Fijados:** 0 o 3 publicaciones fijadas, nunca 1 o 2: los fijados se ponen delante y descuadran las filas.
- **Anuncios y avisos sueltos** (inscripciones, cambios de horario): a Stories. Si tienen que ir al feed, de tres en tres, para no desplazar las filas.
- **El reel 9:16 de highlights** se publica con "Mostrar en la cuadrícula del perfil" desactivado: sale en la pestaña de reels pero no rompe la fila.
- En el carrusel de destacados, los clips se suben como vídeo junto con las fotos. Instagram ordena por el orden en que se tocan los archivos: selecciónalos siguiendo el número del nombre (01, 02, 03…).

## Si cambia algo del sistema

- **Colores, tipografías y retícula:** están en `sistema.css` (tokens en `:root`). Ligeros usa oro; Pesados, rojo; Destacados, blanco.
- **Estructura de cada slide:** hay una plantilla por tipo en `slides/` (portada-categoria, portada, portada-destacados, apertura (la carrera), podio, resultados, clasificación, foto-completa, fotos (galería, solo sin destacados o en modo único) y próxima).
- **Clips:** `scripts/clips.mjs` (recorte, tonemap, volumen y códec).
- **Lectura de la web:** `scripts/datos-web.mjs` lee el HTML público de `/season-2` y `/season-2/rN-...`. Si cambia el marcado de la web, ajusta ese script.
