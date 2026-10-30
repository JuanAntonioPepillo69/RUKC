# carrusel.json

Indica qué foto va en cada slide y qué fotos y clips lleva el post de destacados. Va en la raíz de la carpeta de la carrera. Si no existe, `generar.mjs` crea uno vacío y las slides salen con huecos de foto.

## Formato

Cada foto puede ser una ruta (texto) o un objeto:

- `archivo`: ruta relativa a la carpeta de la carrera, p. ej. `"IMG_6235.JPG"` o `"podios/IMG_7019.jpg"`.
- `foco` (opcional): qué parte de la foto se queda dentro del marco, como `object-position` de CSS. `"50% 50%"` es el centro, `"50% 20%"` sube el encuadre y `"70% 50%"` lo lleva a la derecha.
- `zoom` (opcional, de 1.0 a 2.0): amplía alrededor del `foco`. Sirve para quitar bordes con cabezas cortadas o público en primer plano.

Cada clip es un objeto con `clip`:

- `clip`: ruta del vídeo, relativa a la carpeta de la carrera (`"clips/IMG_6951.MOV"`) o absoluta (`"C:/Users/jrfmp/Videos/Clips/IMG_6951.MOV"`).
- `inicio`: segundo del vídeo original donde empieza el clip.
- `duracion`: segundos (5 a 10).
- `foco_x` (opcional, 0 a 1, por defecto 0.5): dónde está la acción en horizontal. El clip se recorta a 4:5 alrededor de ese punto.
- `zoom` (opcional, 1.0 a 2.0): acerca el recorte.

### Tres posts por ronda (por defecto)

```json
{
  "modo": "por-categoria",
  "categorias": {
    "Ligeros": {
      "portada": { "archivo": "podios/grupo.jpg", "foco": "50% 55%" },
      "apertura": { "archivo": "IMG_6235.JPG", "foco": "62% 55%" },
      "podio": { "archivo": "podios/IMG_7010.jpg", "foco": "50% 30%" }
    },
    "Pesados": {
      "portada": { "archivo": "podios/IMG_7019.jpg", "foco": "55% 62%", "zoom": 1.15 },
      "apertura": { "archivo": "IMG_6305.JPG", "foco": "45% 50%" },
      "podio": { "archivo": "podios/IMG_7018.jpg", "foco": "50% 15%" }
    }
  },
  "proxima": { "archivo": "IMG_6394.JPG", "foco": "50% 60%" },
  "destacados": {
    "portada": { "archivo": "IMG_6300.JPG", "foco": "50% 45%" },
    "items": [
      { "clip": "C:/Users/jrfmp/Videos/Clips/IMG_6951.MOV", "inicio": 19.5, "duracion": 6, "foco_x": 0.5 },
      "IMG_6005.JPG",
      { "archivo": "IMG_6156.JPG", "foco": "30% 50%" },
      { "clip": "C:/Users/jrfmp/Videos/Clips/IMG_6867.MOV", "inicio": 1.45, "duracion": 5 },
      { "archivo": "IMG_6373.JPG", "foco": "50% 10%" }
    ]
  }
}
```

- `apertura` es la slide "La carrera". Si falta, esa slide no se genera.
- `destacados.items` va en el orden del carrusel, justo después de la portada: 8-12 fotos y 2-3 clips (el generador avisa si te sales). Un post no puede pasar de 20 elementos.
- Sin bloque `destacados` salen solo los dos posts de categoría. En ese caso cada categoría puede llevar todavía `"galeria": [{ "fotos": ["a.JPG", "b.JPG"], "disposicion": "apiladas" | "lado" }]` (formato antiguo); con `destacados`, la galería se ignora.

### Un solo post con las dos categorías

Usa `"modo": "unico"` y añade `"portada"` en la raíz (la foto de grupo general). En este modo se ignoran las `portada` de cada categoría y el bloque `destacados`.

Los nombres de categoría tienen que coincidir con los de `datos/ronda.json` (`Ligeros`, `Pesados`).

## Tamaño de cada hueco de foto

| Slide | Marco | Qué funciona |
|---|---|---|
| Portada de categoría o de destacados | 1080 x 650 | Grupo u acción horizontal (4:3 o 3:2), personas en el centro |
| Portada única | 1080 x 690 | Ídem |
| La carrera | 1080 x 680 | Acción horizontal con varios karts |
| Podio | 1080 x 640 | Podio horizontal, recortando cielo y suelo |
| Foto a sangre (destacados) | 1080 x 1350 | Vertical sin recorte; de una horizontal 3:2 queda el 53 % central del ancho: usa `foco` |
| Clip (destacados) | 1080 x 1350 | De un vídeo 16:9 queda el 45 % del ancho alrededor de `foco_x` |
| Galería apiladas (formato antiguo) | 1080 x ~520 cada una | Horizontales |
| Galería lado (formato antiguo) | ~530 x 1080 cada una | Verticales |
| Próxima ronda | 1080 x 640 | Ambiente: cielo, circuito, parrilla |

Si falta una portada o un podio, la slide sale con un hueco y un AVISO.
