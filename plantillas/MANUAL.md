# Manual: posts de Instagram después de cada carrera

Este manual explica cómo pedirle a Claude los posts de una ronda de RUKC. No hace falta saber programar.

Por cada ronda salen **tres posts**, que juntos ocupan una fila del perfil:

| Post | Qué lleva |
|---|---|
| Ligeros | Portada, la carrera, podio, resultados, campeonato y próxima ronda (8 imágenes) |
| Destacados | Portada, 8-12 fotos a pantalla completa y 2-3 vídeos cortos |
| Pesados | Lo mismo que Ligeros, en rojo |

---

## 1. Antes de pedirlo

### Prepara la carpeta de la carrera

1. Crea una carpeta dentro de `Pictures\Carreras` con este nombre: **AAAA-MM-DD_RN_Circuito**.
   - Ejemplo: `2026-11-21_R2_Campillos` (año-mes-día, número de ronda, circuito).
2. Mete **todas las fotos de la cámara** directamente en esa carpeta, sin subcarpetas.
3. Crea dentro una subcarpeta **`podios`** y mete ahí:
   - las fotos de grupo y de podio;
   - las fotos que te hayan pasado por WhatsApp u otras personas.
4. Crea otra subcarpeta **`clips`** y mete ahí los vídeos (los del iPhone y los de la cámara onboard). No hace falta recortarlos.
5. Si alguna foto del móvil está en formato **DNG** (RAW), déjala también en `podios`. Claude la convierte sola; el original no se toca.

Claude nunca modifica, mueve ni borra tus fotos o vídeos. Solo los lee.

### Comprueba la web

Los resultados salen de **raceupkc.com**. Antes de pedir los posts, la ronda tiene que estar **publicada en la web** con resultados y clasificación. Si no lo está, Claude se parará y te lo dirá.

Si ves un nombre mal escrito en la web, corrígelo allí: Claude copia los nombres tal cual.

---

## 2. Cómo pedirlo

Abre una **conversación nueva** en Claude y escribe algo así:

> Usa la skill post-carrera-rukc con la carpeta Pictures\Carreras\2026-11-21_R2_Campillos

Si quieres, añade en el mismo mensaje todo lo que sepas:

> Usa la skill post-carrera-rukc con la carpeta Pictures\Carreras\2026-11-21_R2_Campillos. Los clips están en la subcarpeta clips. Ligeros corrió por la mañana y Pesados por la tarde. Los @ de los pilotos: 38 @juanamador, 22 @manuelmerino, 24 @patriciocastro.

### Qué decide Claude solo

- Qué fotos van en cada slide (portadas, la carrera, podios, destacados).
- Qué trozos de vídeo usar y cómo encuadrarlos.
- Los textos de las descripciones (siempre con datos de la web, sin emojis ni precios).
- Revisa cada imagen y cada vídeo antes de entregártelos.

### Qué te puede preguntar

- El número de ronda, si no aparece en el nombre de la carpeta.
- Qué sesión de fotos es de cada categoría, si no está claro por la luz o la hora.
- Dónde están los vídeos, si no hay carpeta `clips`.
- Qué hacer si la web no tiene publicada la ronda.

---

## 3. Los @ de los pilotos

La web no tiene los Instagram de los pilotos. Si quieres que la descripción los etiquete, pásaselos a Claude con el **dorsal** de cada uno:

> 38 @juanamador, 22 @manuelmerino

Claude los guarda en `datos\instagram.json` dentro de la carpeta de la carrera. Si ya existe de una ronda anterior, puedes copiarlo a la carpeta nueva y así no hay que repetirlo.

---

## 4. Qué te entrega y cómo publicarlo

Todo queda en la carpeta de la carrera, en `salida`:

```
salida\1-pesados       (se publica primero)
salida\2-destacados    (segundo)
salida\3-ligeros       (tercero)
```

Cada carpeta tiene las imágenes (y en destacados, los vídeos) numeradas, y un `descripcion.txt` con el texto para pegar.

### Pasos

1. Publica **1-pesados**. Selecciona las imágenes en orden (01, 02, 03…) y pega el texto de `descripcion.txt`.
2. Unas **3 o 4 horas después** (o al día siguiente), publica **2-destacados**, igual: fotos y vídeos en orden de número.
3. Otras 3 o 4 horas después, publica **3-ligeros**.

Así la fila del perfil queda **Ligeros | Destacados | Pesados** (oro, blanco, rojo).

### Para no descuadrar la cuadrícula

- **Publicaciones fijadas:** 0 o 3, nunca 1 o 2.
- **Anuncios sueltos** (inscripciones, horarios, avisos): a **Stories**. Si tienen que ir al perfil, de tres en tres.
- **El reel vertical** de highlights: al publicarlo, desactiva **"Mostrar en la cuadrícula del perfil"**.

---

## 5. Pedir cambios

Escríbelo en la **misma conversación**, con el nombre del archivo. Ejemplos:

- "En destacados, la 06 corta la cabeza al piloto: encuádrala más arriba."
- "Cambia la portada de Pesados por otra foto de grupo donde se vean todas las caras."
- "Quita la foto 09 de destacados y pon otra del podio."
- "El clip 07 empieza demasiado pronto: que empiece un segundo después."
- "Pon el clip del onboard el primero."
- "Cambia la descripción de Ligeros: menciona que fue su primera victoria."

Claude vuelve a generar solo lo necesario y te lo enseña otra vez.

---

## 6. Si algo falla

| Qué pasa | Qué hacer |
|---|---|
| "La web no tiene publicada la ronda" | Publica la ronda en raceupkc.com y vuelve a pedirlo. |
| Un hueco rayado con "FALTA DATO" | Falta ese dato en la web. Complétalo allí y pide que lo regenere. |
| Un nombre mal escrito | Corrígelo en la web y pide que lo regenere. |
| "No se encuentra ffmpeg" (no salen los vídeos) | Pide a Claude: "instala ffmpeg con winget". |
| Una foto que no te gusta | Pide el cambio (ver punto 5). |
| No encuentra las fotos | Revisa el nombre de la carpeta y que las fotos no estén en subcarpetas (salvo `podios` y `clips`). |
| Cualquier otra cosa | Cuéntale a Claude qué ves, en una frase, y pídele que lo revise. |

---

## Ahorrar tokens

Cada conversación tiene un coste. Estas costumbres lo reducen mucho:

- **Una conversación nueva por carrera.** No sigas en la conversación de la carrera anterior: arrastra todo lo que se habló antes.
- **Pídelo todo en un mensaje.** Carpeta, dónde están los clips, qué sesión es cada categoría y los @. Cada pregunta y respuesta extra cuesta.
- **No pegues imágenes en el chat.** Deja las fotos en la carpeta y di su nombre ("la IMG_6300"). Una imagen pegada cuesta mucho más que un nombre.
- **Pide los cambios juntos.** "Cambia la 06, la 09 y la portada de Pesados" mejor que tres mensajes.
- **No pidas ver todo otra vez** si solo ha cambiado una imagen: pide ver esa.
