# Imágenes semanales de inscritos

Cada miércoles a las 19:00 (hora de Madrid) se generan dos imágenes de 1080x1350, Ligeros y Pesados, con la parrilla de
la próxima ronda, y le llegan a John por WhatsApp desde el número RUKC para que las reenvíe al grupo de pilotos. Nada se
publica en el grupo de forma automática.

## Qué sale en cada imagen

- Ronda, circuito y fecha de la próxima ronda (la primera programada o aplazada con fecha de hoy en adelante). Cuando
  pasa una carrera, la siguiente semana ya sale la ronda siguiente.
- Plazas: las de `cupo_ronda`, salvo las excepciones de `PLAZAS_IMAGEN` en `lib/inscritos/datos.js` (R2 de la T2: 30
  por categoría).
- Parrilla: inscripciones con pago confirmado (reservada, pagada o asistió), en orden alfabético, con dorsal y nombre de
  competición de la ficha (si no hay ficha, nombre e inicial del apellido). Nunca email, teléfono, edad ni peso.
- Las plazas que faltan, al final como huecos: el primero "¿Podrías ser tú?", el resto "Hueco libre".
- Las inscripciones con pago sin categoría no salen; John recibe un aviso para asignarla en el panel.

Con cada imagen llega un texto para el grupo que cambia según la situación (vacía, con sitio, últimas plazas, completa,
semana de carrera) y rota cada semana (`lib/inscritos/textos.js`).

## Cómo llega a WhatsApp

1. Si John ha escrito al número RUKC en las últimas 24 h: dos mensajes de imagen con el texto para el grupo como pie.
2. Si no: la plantilla `rukc_inscritos_semana` (abajo), con la imagen de cabecera.
3. Si la plantilla falla (por ejemplo, aún no está aprobada): un solo aviso de siempre (`rukc_aviso_admin`); al contestar,
   llegan las dos imágenes con el texto para el grupo de pie (si una no sale, su enlace, que vale 7 días).

Se manda una sola vez por ronda, día y categoría (cerrojo en `wa_outbox`, automatización A4).

## Plantilla que hay que crear en YCloud

- Nombre: `rukc_inscritos_semana` · Categoría: Utility · Idioma: Spanish (es)
- Cabecera: Image (como ejemplo vale cualquier imagen de inscritos)
- Cuerpo:

```
Inscritos de la semana para reenviar al grupo.

Categoría: {{1}}
Ronda: {{2}}
Plazas: {{3}}

Texto sugerido para el grupo: {{4}}

Generado por raceupkc.com
```

Ejemplos de variables: `Pesados` · `Ronda 2 · Karting Campillos · domingo 22 de noviembre` · `24 de 30 ocupadas, 6 libres` ·
`Ronda 2, Pesados: 6 plazas libres de 30. raceupkc.com/inscripcion`

## Lanzarlo a mano

En local, sin enviar nada (las imágenes quedan en `exportaciones/inscritos/`):

```bash
npm run inscritos:generar:produccion
```

```bash
npm run inscritos:generar -- --prueba todos
```

En producción, con `CRON_SECRET`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://raceupkc.com/api/inscritos/semanal?simular=1"
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://raceupkc.com/api/inscritos/semanal?forzar=1"
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" -o pesados.png "https://raceupkc.com/api/inscritos/imagen?categoria=PES"
```

`simular=1` devuelve los enlaces firmados y los textos sin enviar nada; `forzar=1` envía ahora aunque no sea miércoles
o ya se haya enviado hoy. En la imagen, `&prueba=0|1|25|50|largos` usa datos inventados.

## Cambiar el día o la hora

Hay que tocar dos sitios y que coincidan:

1. `DIA_HORA` en `api/inscritos/semanal.js` (día: 0 domingo … 3 miércoles … 6 sábado; hora de Madrid).
2. El `schedule` de `/api/inscritos/semanal` en `vercel.json`, en UTC y con las dos horas posibles por el cambio de
   hora: la hora de Madrid menos 1 (invierno) y menos 2 (verano). Para miércoles a las 19:00: `0 17,18 * * 3`. Para
   lunes a las 10:00: `0 8,9 * * 1`.

El cron se lanza en las dos horas UTC y solo actúa en la que coincide con la hora de Madrid.

## Archivos

- `lib/inscritos/datos.js` · próxima ronda, parrilla y plazas
- `lib/inscritos/imagen.js` y `lib/inscritos/recursos/` · diseño, fuentes, escudo y foto
- `lib/inscritos/textos.js` · texto para el grupo
- `lib/inscritos/enlace.js` · enlaces firmados y token
- `lib/inscritos/envio.js` · envío a John
- `lib/inscritos/prueba.js` · datos inventados para probar
- `api/inscritos/imagen.js` · PNG · `api/inscritos/semanal.js` · cron
- `tools/inscritos/generar.mjs` · generación local · `tools/inscritos/fuentes.py` · regenerar las fuentes
- `tests/inscritos.test.ts`
