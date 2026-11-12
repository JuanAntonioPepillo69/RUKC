-- 0013 · Formulario de inscripción v2 (fase 2 del bot de WhatsApp): piloto menor con los datos de su tutor y casilla
-- opcional de avisos de RUKC por WhatsApp. Solo añade columnas con valor por defecto o que admiten nulo a
-- solicitud_inscripcion; no cambia ni borra nada.
ALTER TABLE solicitud_inscripcion ADD COLUMN piloto_menor              boolean NOT NULL DEFAULT false;
ALTER TABLE solicitud_inscripcion ADD COLUMN tutor_nombre              text;
ALTER TABLE solicitud_inscripcion ADD COLUMN tutor_telefono            text CHECK (tutor_telefono ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE solicitud_inscripcion ADD COLUMN tutor_relacion            text CHECK (tutor_relacion IN ('padre', 'madre', 'tutor_legal'));
ALTER TABLE solicitud_inscripcion ADD COLUMN acepta_whatsapp_novedades boolean NOT NULL DEFAULT false;
