-- 0015 · Feedback anónimo post-carrera y sorteo entre quienes respondan (formularios /feedback/<ronda> y
-- /feedback/<ronda>/sorteo). Sustituye en la práctica al feedback por enlace personal de F6 (envio_feedback), que se
-- queda sin usar.
--
-- Anonimato (requisito de John, no negociable):
-- - Respuestas y sorteo en tablas separadas, sin ningún campo común (ni clave foránea, ni token, ni sesión).
-- - Ids UUID aleatorios (v4), nunca secuencias.
-- - Sin IP, user agent ni hora: solo la fecha (hora de Madrid) que pone el servidor.
-- - Sin triggers de historial (evento) ni columnas creado_en / actualizado_en / creado_por, que guardarían la hora.
-- - Postgres guarda en cada fila, de forma oculta, su posición física (ctid) y la transacción que la escribió (xmin),
--   que delatarían el orden de llegada aunque los ids sean aleatorios. Por eso solo se escribe con las funciones de
--   abajo: añaden la fila y reescriben todas las de la ronda en orden aleatorio en la misma transacción, de modo que
--   todas comparten xmin y su orden físico es aleatorio.

CREATE TABLE feedback_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     text NOT NULL CHECK (round_id ~ '^T[0-9]+-R[0-9]+$'),
  form_version text NOT NULL CHECK (form_version ~ '^[A-Za-z0-9._-]{1,30}$'),
  submitted_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Madrid')::date,
  answers      jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object')
);

CREATE TABLE raffle_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         text NOT NULL CHECK (round_id ~ '^T[0-9]+-R[0-9]+$'),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  whatsapp         text NOT NULL CHECK (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  created_on       date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Madrid')::date,
  privacy_accepted boolean NOT NULL CHECK (privacy_accepted),
  UNIQUE (round_id, whatsapp)
);

-- Añade una respuesta y rebaraja las de su ronda. Devuelve el id nuevo.
CREATE OR REPLACE FUNCTION guardar_feedback_anonimo(p_round text, p_version text, p_answers jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  nuevo uuid;
BEGIN
  LOCK TABLE feedback_responses IN SHARE ROW EXCLUSIVE MODE;
  INSERT INTO feedback_responses (round_id, form_version, answers) VALUES (p_round, p_version, p_answers)
    RETURNING id INTO nuevo;
  WITH borradas AS (DELETE FROM feedback_responses WHERE round_id = p_round RETURNING *)
  INSERT INTO feedback_responses (id, round_id, form_version, submitted_on, answers)
    SELECT id, round_id, form_version, submitted_on, answers FROM borradas ORDER BY random();
  RETURN nuevo;
END
$$;

-- Añade una participación al sorteo y rebaraja las de su ronda. Devuelve false si ese WhatsApp ya estaba dentro.
CREATE OR REPLACE FUNCTION guardar_sorteo(p_round text, p_name text, p_whatsapp text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE raffle_entries IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM raffle_entries WHERE round_id = p_round AND whatsapp = p_whatsapp) THEN
    RETURN false;
  END IF;
  INSERT INTO raffle_entries (round_id, name, whatsapp, privacy_accepted) VALUES (p_round, btrim(p_name), p_whatsapp, true);
  WITH borradas AS (DELETE FROM raffle_entries WHERE round_id = p_round RETURNING *)
  INSERT INTO raffle_entries (id, round_id, name, whatsapp, created_on, privacy_accepted)
    SELECT id, round_id, name, whatsapp, created_on, privacy_accepted FROM borradas ORDER BY random();
  RETURN true;
END
$$;

-- La aplicación no edita filas: solo añade (con las funciones), lee, y borra (al rebarajar y al purgar el sorteo).
REVOKE UPDATE, TRUNCATE ON feedback_responses, raffle_entries FROM rukc_app;
