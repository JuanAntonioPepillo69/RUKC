-- 0008 · Nuevo origen de categoría: sin_consentimiento_peso.
-- Reglamento v1.1, Art. 23 bis f: el piloto que no da su consentimiento para el pesaje corre en Pesados con 10 kg de
-- lastre y sin registro de su peso. El onboarding pone entonces sus inscripciones en la categoría sin límite de peso
-- con este origen, para que el pesaje del circuito sepa que lleva los 10 kg y que no se le pesa.

ALTER TABLE inscripcion DROP CONSTRAINT IF EXISTS inscripcion_categoria_origen_check;
ALTER TABLE inscripcion ADD CONSTRAINT inscripcion_categoria_origen_check
  CHECK (categoria_origen IN ('por_peso', 'eleccion_franja', 'pendiente', 'sin_consentimiento_peso'));
