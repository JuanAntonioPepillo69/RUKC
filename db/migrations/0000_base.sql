-- 0000 · Base: extensiones, función común de fecha de actualización y tabla de historial (evento).
-- Diseño: docs/base-datos/diseno-v1.0.md, secciones "Convenciones del esquema" y "Sistema".

-- gen_random_uuid() y digest() para hashes; citext para emails sin distinguir mayúsculas.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Se engancha en las tablas de negocio con:
--   CREATE TRIGGER <tabla>_actualizado_en BEFORE UPDATE ON <tabla>
--   FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE OR REPLACE FUNCTION set_actualizado_en() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

-- Historial de solo añadir. Lo escriben los triggers de las tablas de negocio (fase 1).
-- La conexión de la aplicación (rukc_app) no podrá modificarlo ni borrarlo (permisos en fase 1).
CREATE TABLE IF NOT EXISTS evento (
  id          bigserial PRIMARY KEY,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL,          -- publico · sistema · stripe · admin:<id>
  entidad     text NOT NULL,          -- nombre de la tabla afectada
  entidad_id  text,                   -- texto: casi siempre un uuid, pero también ids de Stripe o claves compuestas
  accion      text NOT NULL,          -- p. ej. estado, importe, aceptacion, exportacion_sensible
  antes       jsonb,
  despues     jsonb,
  ip          text
);

CREATE INDEX IF NOT EXISTS evento_entidad_idx ON evento (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS evento_ocurrido_en_idx ON evento (ocurrido_en);
