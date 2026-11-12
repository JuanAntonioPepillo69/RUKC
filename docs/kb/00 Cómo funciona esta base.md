---
bot: false
---

# Base de conocimiento del bot de RUKC

Esta carpeta es una bóveda de Obsidian. Ábrela en Obsidian con "Abrir carpeta como bóveda" (`docs/kb`).

## Cómo funciona

- Cada nota es un documento que el bot conoce. Lo que pone la nota es lo que el bot puede decir: si un dato no está aquí ni en la web, el bot no lo inventa y te lo pasa a ti.
- La cabecera de cada nota (entre las dos líneas `---`) dice cómo la usa el bot:
  - `slug`: nombre interno. No lo cambies una vez cargada la nota.
  - `categoria`: liga, categorias, precios, politicas, reglamento, dia_de_carrera, menores, enlaces o faq.
  - `bot: false`: la nota no se carga (como esta).
- Las líneas que contienen `[JOHN: ...]` no se cargan. Úsalas para lo que tienes pendiente; cuando lo rellenes, quita la marca.
- Puedes enlazar notas con `[[Nombre de la nota]]`. El bot ve solo el texto del enlace.
- Las fechas, plazas y cierres de inscripción no van aquí: salen de la base de datos de la web (tabla de rondas). Las horas de acreditación y briefing y el enlace de Maps de cada ronda también van en esa tabla.

## Cómo se carga en el bot

Después de editar, desde la carpeta del proyecto:

```
npm run bot:kb -- --seco
npm run bot:kb
```

El primero enseña qué cambiaría sin tocar nada. El segundo lo carga (en desarrollo; en producción, con `node --env-file=.env.produccion db/kb-sincronizar.mjs`). Cada cambio guarda la versión anterior.

## Notas

- [[Qué es RUKC]]
- [[Puntos y clasificación]]
- [[Precios y pagos]]
- [[Cancelaciones, cesiones y devoluciones]]
- [[Categorías, pesaje y lastre]]
- [[Acreditación, briefing y formato]]
- [[Qué llevar]]
- [[Menores de edad]]
- Circuitos: [[Karting Campillos]], [[Karting Mijas]], [[Kart&Fun Málaga]], [[Kart&Fun Estepona]], [[Karting del Sol]]
- [[Enlaces]]
- [[Objeciones]] (pendiente)
