-- 0002 · Catálogo: temporadas, circuitos, rondas, categorías, cupos, productos y tarifas, descuentos.
-- Diseño: docs/base-datos/diseno-v1.0.md, "Tablas: catálogo". Todo es editable desde el panel; nada vive en el código.

-- Para impedir solapes de vigencia (tarifas y documentos legales) con EXCLUDE sobre uuid.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =========================================================================================
-- temporada (FK a plantilla_feedback en 0004)
-- =========================================================================================
CREATE TABLE temporada (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                  text NOT NULL UNIQUE,
  nombre                  text NOT NULL,
  inicio                  date,
  fin                     date,
  estado                  text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'abierta', 'en_curso', 'cerrada')),
  importe_reserva_cent    integer NOT NULL CHECK (importe_reserva_cent >= 0),
  dias_aviso_traslado     smallint NOT NULL CHECK (dias_aviso_traslado >= 0),
  -- Regla 1: si un piloto de la franja 80,1–84,9 kg puede inscribirse en las dos categorías.
  -- Es configuración: el esquema no la aplica (la usa la aplicación al inscribir).
  franja_ambas_categorias boolean NOT NULL DEFAULT true,
  enlace_grupo_whatsapp   text,
  plantilla_feedback_id   uuid,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por              text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT temporada_fechas CHECK (fin IS NULL OR inicio IS NULL OR fin >= inicio)
);

ALTER TABLE dorsal_temporada ADD CONSTRAINT dorsal_temporada_temporada_fk
  FOREIGN KEY (temporada_id) REFERENCES temporada (id) ON DELETE RESTRICT;
ALTER TABLE oportunidad ADD CONSTRAINT oportunidad_temporada_fk
  FOREIGN KEY (temporada_id) REFERENCES temporada (id) ON DELETE RESTRICT;

-- =========================================================================================
-- circuito
-- =========================================================================================
CREATE TABLE circuito (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                text NOT NULL UNIQUE,
  municipio             text,
  edad_minima           smallint CHECK (edad_minima BETWEEN 0 AND 99),
  seguro_aseguradora    text,
  seguro_cubre_terceros text NOT NULL DEFAULT 'sin_confirmar' CHECK (seguro_cubre_terceros IN ('si', 'no', 'sin_confirmar')),
  seguro_confirmado_en  date,
  seguro_documento_path text,   -- almacén privado
  activo                boolean NOT NULL DEFAULT true,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por            text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

-- =========================================================================================
-- ronda
-- =========================================================================================
CREATE TABLE ronda (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  numero         smallint NOT NULL CHECK (numero BETWEEN 1 AND 8),
  circuito_id    uuid NOT NULL REFERENCES circuito (id) ON DELETE RESTRICT,
  fecha          date NOT NULL,
  hora_inicio    time,
  estado         text NOT NULL DEFAULT 'programada' CHECK (estado IN ('programada', 'aplazada', 'celebrada', 'cancelada')),
  puntuable      boolean NOT NULL DEFAULT true,
  notas          text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (temporada_id, numero)
);

-- Transiciones de ronda: programada → celebrada; programada ⇄ aplazada; programada · aplazada → cancelada
-- (cancelar la ronda cancela sus inscripciones activas: trigger en 0003).
CREATE OR REPLACE FUNCTION transicion_ronda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('ronda', CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado, ARRAY[
    '(nuevo)>programada',
    'programada>celebrada', 'programada>aplazada', 'aplazada>programada',
    'programada>cancelada', 'aplazada>cancelada']);
  RETURN NEW;
END
$$;
CREATE TRIGGER ronda_transicion BEFORE INSERT OR UPDATE OF estado ON ronda
  FOR EACH ROW EXECUTE FUNCTION transicion_ronda();

-- =========================================================================================
-- categoria y regla_categoria
-- =========================================================================================
CREATE TABLE categoria (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  codigo         text NOT NULL CHECK (codigo ~ '^[A-Z]{3}$'),   -- LIG · PES
  nombre         text NOT NULL,
  peso_minimo_kg numeric(5,1) NOT NULL CHECK (peso_minimo_kg BETWEEN 30 AND 200),  -- quien pese menos lleva lastre hasta aquí
  orden          smallint NOT NULL DEFAULT 1,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (temporada_id, codigo)
);

-- Decide la categoría a partir del peso con equipo. Se lee en orden ascendente de hasta_kg (NULL = sin límite,
-- va la última); la primera fila que cumple manda. resultado: código de categoría o 'eleccion'.
CREATE TABLE regla_categoria (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  hasta_kg       numeric(5,1) CHECK (hasta_kg BETWEEN 30 AND 200),
  resultado      text NOT NULL CHECK (resultado = 'eleccion' OR resultado ~ '^[A-Z]{3}$'),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE NULLS NOT DISTINCT (temporada_id, hasta_kg)
);

-- Categoría para un peso: devuelve el código ('LIG', 'PES'...) o 'eleccion'.
CREATE OR REPLACE FUNCTION categoria_por_peso(p_temporada uuid, p_peso numeric) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT resultado FROM regla_categoria
  WHERE temporada_id = p_temporada AND (hasta_kg IS NULL OR p_peso <= hasta_kg)
  ORDER BY hasta_kg ASC NULLS LAST
  LIMIT 1
$$;

-- =========================================================================================
-- cupo_ronda: plazas y estado de inscripción por ronda y categoría (lo mueve solo el admin)
-- =========================================================================================
CREATE TABLE cupo_ronda (
  ronda_id           uuid NOT NULL REFERENCES ronda (id) ON DELETE RESTRICT,
  categoria_id       uuid NOT NULL REFERENCES categoria (id) ON DELETE RESTRICT,
  plazas             smallint NOT NULL DEFAULT 50 CHECK (plazas >= 0),
  estado_inscripcion text NOT NULL DEFAULT 'cerrada' CHECK (estado_inscripcion IN ('abierta', 'cerrada', 'lista_espera')),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  PRIMARY KEY (ronda_id, categoria_id)
);

-- La ronda y la categoría de un cupo son de la misma temporada.
CREATE OR REPLACE FUNCTION cupo_misma_temporada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT temporada_id FROM ronda WHERE id = NEW.ronda_id)
     IS DISTINCT FROM (SELECT temporada_id FROM categoria WHERE id = NEW.categoria_id) THEN
    RAISE EXCEPTION 'La ronda y la categoría del cupo son de temporadas distintas' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cupo_ronda_temporada BEFORE INSERT OR UPDATE OF ronda_id, categoria_id ON cupo_ronda
  FOR EACH ROW EXECUTE FUNCTION cupo_misma_temporada();

-- =========================================================================================
-- producto y tarifa (la reserva de 30 € no es un producto: es un importe a cuenta, en temporada)
-- =========================================================================================
CREATE TABLE producto (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id     uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  codigo           text NOT NULL CHECK (codigo IN ('carrera_suelta', 'temporada_completa', 'temporada_resto')),
  rondas_incluidas smallint CHECK (rondas_incluidas BETWEEN 1 AND 8),   -- NULL = las que queden
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (temporada_id, codigo)
);

CREATE TABLE tarifa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id    uuid NOT NULL REFERENCES producto (id) ON DELETE RESTRICT,
  precio_cent    integer NOT NULL CHECK (precio_cent >= 0),
  vigente_desde  timestamptz NOT NULL,
  vigente_hasta  timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT tarifa_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  CONSTRAINT tarifa_sin_solapes EXCLUDE USING gist (producto_id WITH =, tstzrange(vigente_desde, vigente_hasta) WITH &&)
);

-- Precio vigente de un producto en un momento dado.
CREATE OR REPLACE FUNCTION precio_vigente_cent(p_producto uuid, p_en timestamptz DEFAULT now()) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT precio_cent FROM tarifa
  WHERE producto_id = p_producto AND vigente_desde <= p_en AND (vigente_hasta IS NULL OR vigente_hasta > p_en)
$$;

-- =========================================================================================
-- codigo_descuento y regla_grupo
-- =========================================================================================
CREATE TABLE codigo_descuento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL UNIQUE CHECK (codigo = upper(codigo)),
  tipo           text NOT NULL CHECK (tipo IN ('porcentaje', 'importe_fijo')),
  valor          integer NOT NULL,   -- % (1–100) o céntimos
  productos      text[],             -- NULL = todos
  usos_maximos   integer CHECK (usos_maximos > 0),   -- NULL = ilimitado
  valido_desde   timestamptz,
  valido_hasta   timestamptz,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT codigo_descuento_valor CHECK ((tipo = 'porcentaje' AND valor BETWEEN 1 AND 100) OR (tipo = 'importe_fijo' AND valor > 0)),
  CONSTRAINT codigo_descuento_productos CHECK (productos IS NULL OR productos <@ ARRAY['carrera_suelta', 'temporada_completa', 'temporada_resto']),
  CONSTRAINT codigo_descuento_fechas CHECK (valido_hasta IS NULL OR valido_desde IS NULL OR valido_hasta > valido_desde)
);

CREATE TABLE regla_grupo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  min_pilotos    smallint NOT NULL CHECK (min_pilotos >= 2),   -- valores pendientes de definir (regla 4)
  tipo           text NOT NULL CHECK (tipo IN ('porcentaje', 'importe_fijo')),
  valor          integer NOT NULL,
  activo         boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT regla_grupo_valor CHECK ((tipo = 'porcentaje' AND valor BETWEEN 1 AND 100) OR (tipo = 'importe_fijo' AND valor > 0))
);

-- =========================================================================================
-- Índices
-- =========================================================================================
CREATE INDEX ronda_circuito_idx        ON ronda (circuito_id);
CREATE INDEX ronda_fecha_idx           ON ronda (fecha);
CREATE INDEX categoria_temporada_idx   ON categoria (temporada_id);
CREATE INDEX regla_categoria_temp_idx  ON regla_categoria (temporada_id);
CREATE INDEX cupo_ronda_categoria_idx  ON cupo_ronda (categoria_id);
CREATE INDEX producto_temporada_idx    ON producto (temporada_id);
CREATE INDEX tarifa_producto_idx       ON tarifa (producto_id);
CREATE INDEX regla_grupo_temporada_idx ON regla_grupo (temporada_id);
CREATE INDEX temporada_plantilla_idx   ON temporada (plantilla_feedback_id);

-- =========================================================================================
-- actualizado_en e historial
-- =========================================================================================
CREATE TRIGGER temporada_actualizado_en        BEFORE UPDATE ON temporada        FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER circuito_actualizado_en         BEFORE UPDATE ON circuito         FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER ronda_actualizado_en            BEFORE UPDATE ON ronda            FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER categoria_actualizado_en        BEFORE UPDATE ON categoria        FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER regla_categoria_actualizado_en  BEFORE UPDATE ON regla_categoria  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER cupo_ronda_actualizado_en       BEFORE UPDATE ON cupo_ronda       FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER producto_actualizado_en         BEFORE UPDATE ON producto         FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER tarifa_actualizado_en           BEFORE UPDATE ON tarifa           FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER codigo_descuento_actualizado_en BEFORE UPDATE ON codigo_descuento FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER regla_grupo_actualizado_en      BEFORE UPDATE ON regla_grupo      FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER temporada_evento        AFTER INSERT OR UPDATE ON temporada        FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,importe_reserva_cent,dias_aviso_traslado,franja_ambas_categorias');
CREATE TRIGGER ronda_evento            AFTER INSERT OR UPDATE ON ronda            FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,fecha,circuito_id');
CREATE TRIGGER cupo_ronda_evento       AFTER INSERT OR UPDATE ON cupo_ronda       FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado_inscripcion,plazas', 'ronda_id,categoria_id');
CREATE TRIGGER tarifa_evento           AFTER INSERT OR UPDATE ON tarifa           FOR EACH ROW EXECUTE FUNCTION registrar_evento('precio_cent,vigente_desde,vigente_hasta');
CREATE TRIGGER codigo_descuento_evento AFTER INSERT OR UPDATE ON codigo_descuento FOR EACH ROW EXECUTE FUNCTION registrar_evento('tipo,valor,activo');
CREATE TRIGGER regla_grupo_evento      AFTER INSERT OR UPDATE ON regla_grupo      FOR EACH ROW EXECUTE FUNCTION registrar_evento('min_pilotos,tipo,valor,activo');
