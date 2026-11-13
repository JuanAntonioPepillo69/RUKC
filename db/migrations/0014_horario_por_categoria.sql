-- 0014 · Horario de cada ronda por categoría (fase 3 del bot: recordatorios). En la R2, los Ligeros tienen que estar a
-- las 15:00 y los Pesados a las 16:00: la hora de llegada (acreditación y pesaje) y la del briefing van por cupo.
-- Si están vacías, valen las de la ronda (ronda.hora_acreditacion y ronda.hora_briefing).
-- Solo añade dos columnas que admiten nulo a cupo_ronda; no cambia ni borra nada.
ALTER TABLE cupo_ronda ADD COLUMN hora_llegada  time;
ALTER TABLE cupo_ronda ADD COLUMN hora_briefing time;
