-- 0001 · Funciones comunes + tablas de identidad y captación.
-- Diseño: docs/base-datos/diseno-v1.0.md, "Convenciones del esquema" y "Tablas: identidad y captación".
-- Las claves foráneas hacia tablas de bloques posteriores (temporada, solicitud, admin) se añaden en esas migraciones.

-- =========================================================================================
-- Funciones comunes
-- =========================================================================================

-- Quién hace el cambio y desde qué IP: la aplicación lo fija por transacción con
--   SELECT set_config('rukc.actor', 'admin:<id>', true), set_config('rukc.ip', '<ip>', true);
CREATE OR REPLACE FUNCTION actor_actual() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('rukc.actor', true), ''), 'sistema')
$$;
CREATE OR REPLACE FUNCTION ip_actual() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('rukc.ip', true), '')
$$;

-- Historial: escribe en evento los cambios de las columnas vigiladas (estado, importes, aceptaciones).
-- Uso: AFTER INSERT OR UPDATE [OR DELETE] ... EXECUTE FUNCTION registrar_evento('col1,col2'[, 'clave1,clave2']).
-- Solo copia las columnas vigiladas, nunca datos personales, porque evento no se puede borrar.
CREATE OR REPLACE FUNCTION registrar_evento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cols      text[] := string_to_array(TG_ARGV[0], ',');
  claves    text[] := string_to_array(coalesce(TG_ARGV[1], 'id'), ',');
  viejo     jsonb;
  nuevo     jsonb;
  antes     jsonb := '{}';
  despues   jsonb := '{}';
  cambiadas text[] := '{}';
  c         text;
  ident     text;
  accion    text;
BEGIN
  IF TG_OP <> 'INSERT' THEN viejo := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN nuevo := to_jsonb(NEW); END IF;
  FOREACH c IN ARRAY cols LOOP
    IF viejo IS NOT NULL THEN antes := antes || jsonb_build_object(c, viejo -> c); END IF;
    IF nuevo IS NOT NULL THEN despues := despues || jsonb_build_object(c, nuevo -> c); END IF;
    IF TG_OP = 'UPDATE' AND (viejo -> c) IS DISTINCT FROM (nuevo -> c) THEN cambiadas := cambiadas || c; END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND cardinality(cambiadas) = 0 THEN RETURN NULL; END IF;

  SELECT string_agg(coalesce(nuevo, viejo) ->> k, ':' ORDER BY o) INTO ident
  FROM unnest(claves) WITH ORDINALITY AS u(k, o);

  accion := CASE TG_OP
    WHEN 'INSERT' THEN 'alta'
    WHEN 'DELETE' THEN 'baja'
    ELSE CASE
      WHEN EXISTS (SELECT 1 FROM unnest(cambiadas) x WHERE x IN ('estado', 'etapa') OR x LIKE 'estado\_%') THEN 'estado'
      WHEN EXISTS (SELECT 1 FROM unnest(cambiadas) x WHERE x LIKE '%\_cent') THEN 'importe'
      ELSE 'cambio'
    END
  END;

  INSERT INTO evento (actor, entidad, entidad_id, accion, antes, despues, ip)
  VALUES (actor_actual(), TG_TABLE_NAME, ident, accion,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE antes END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE despues END,
          ip_actual());
  RETURN NULL;
END
$$;

-- Comprueba que una transición de estado está en la lista permitida ('de>a'; el estado inicial se escribe '(nuevo)').
CREATE OR REPLACE FUNCTION exigir_transicion(entidad text, de text, a text, permitidas text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ((coalesce(de, '(nuevo)') || '>' || a) = ANY (permitidas)) THEN
    RAISE EXCEPTION 'Transición no permitida en %: % → %', entidad, coalesce(de, '(nuevo)'), a
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

-- Valores válidos de creado_por: publico · sistema · admin:<id>
CREATE OR REPLACE FUNCTION creado_por_valido(v text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IN ('publico', 'sistema') OR v ~ '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- =========================================================================================
-- persona: una sola vez por persona, aunque sea lead, piloto, pagador y tutor a la vez
-- =========================================================================================
CREATE TABLE persona (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  apellidos      text,
  email          citext UNIQUE,
  telefono       text UNIQUE CHECK (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  municipio      text,
  instagram      text,
  origen_alta    text NOT NULL CHECK (origen_alta IN ('formulario_web', 'alta_manual', 'onboarding', 'importacion')),
  estado         text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'anonimizada')),
  anonimizada_en timestamptz,
  notas          text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT persona_contacto CHECK (estado = 'anonimizada' OR email IS NOT NULL OR telefono IS NOT NULL),
  CONSTRAINT persona_anonimizada_en CHECK ((estado = 'anonimizada') = (anonimizada_en IS NOT NULL))
);

-- =========================================================================================
-- perfil_piloto (1:1 con persona)
-- =========================================================================================
CREATE TABLE perfil_piloto (
  persona_id         uuid PRIMARY KEY REFERENCES persona (id) ON DELETE RESTRICT,
  nombre_competicion text NOT NULL,
  foto_blob_path     text,
  experiencia        text CHECK (experiencia IN ('ninguna', 'ocasional', 'amateur', 'competicion')),
  frecuencia         text CHECK (frecuencia IN ('ocasional', 'mensual', 'semanal', 'varias_por_semana')),
  ligas_previas      text,
  circuitos_rodados  text[],
  altura_cm          smallint CHECK (altura_cm BETWEEN 120 AND 230),
  objetivo           text,
  como_nos_conocio   text,
  comentarios        text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT perfil_ligas_previas CHECK (ligas_previas IS NULL OR experiencia IN ('amateur', 'competicion'))
);

-- Nombre de competición por defecto: nombre + inicial del apellido ("Carlos M.").
CREATE OR REPLACE FUNCTION perfil_nombre_por_defecto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nombre_competicion IS NULL OR btrim(NEW.nombre_competicion) = '' THEN
    SELECT btrim(p.nombre || coalesce(' ' || upper(left(btrim(p.apellidos), 1)) || '.', ''))
      INTO NEW.nombre_competicion
      FROM persona p WHERE p.id = NEW.persona_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER perfil_piloto_nombre BEFORE INSERT ON perfil_piloto
  FOR EACH ROW EXECUTE FUNCTION perfil_nombre_por_defecto();

-- =========================================================================================
-- dorsal_temporada (FK a temporada en 0002)
-- =========================================================================================
CREATE TABLE dorsal_temporada (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL,
  persona_id     uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  dorsal         smallint NOT NULL CHECK (dorsal BETWEEN 1 AND 999),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (temporada_id, dorsal),
  UNIQUE (temporada_id, persona_id)
);

-- =========================================================================================
-- datos_sensibles_piloto (1:1, acceso restringido; excluidos de exportaciones por defecto)
-- =========================================================================================
CREATE TABLE datos_sensibles_piloto (
  persona_id          uuid PRIMARY KEY REFERENCES persona (id) ON DELETE RESTRICT,
  fecha_nacimiento    date NOT NULL,
  documento_tipo      text CHECK (documento_tipo IN ('dni', 'nie', 'pasaporte')),
  documento_cifrado   bytea,          -- AES-256-GCM en la aplicación, clave RUKC_DATA_KEY
  documento_ultimos3  text CHECK (char_length(documento_ultimos3) = 3),
  peso_declarado_kg   numeric(5,1) CHECK (peso_declarado_kg BETWEEN 30 AND 200),
  peso_declarado_en   timestamptz,
  emergencia_nombre   text NOT NULL,
  emergencia_telefono text NOT NULL,
  emergencia_relacion text,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT sensibles_documento CHECK ((documento_tipo IS NULL) = (documento_cifrado IS NULL)
                                        AND (documento_cifrado IS NULL) = (documento_ultimos3 IS NULL)),
  CONSTRAINT sensibles_peso_fecha CHECK ((peso_declarado_kg IS NULL) = (peso_declarado_en IS NULL))
);
-- El peso exige consentimiento de peso vigente: trigger en 0004, cuando existe la tabla aceptacion.

-- =========================================================================================
-- tutela
-- =========================================================================================
CREATE TABLE tutela (
  menor_persona_id uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  tutor_persona_id uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  relacion         text NOT NULL CHECK (relacion IN ('padre', 'madre', 'tutor_legal')),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  PRIMARY KEY (menor_persona_id, tutor_persona_id),
  CONSTRAINT tutela_distintos CHECK (menor_persona_id <> tutor_persona_id)
);

-- =========================================================================================
-- atribucion: una fila por cada contacto con origen conocido (FK a solicitud en 0003)
-- =========================================================================================
CREATE TABLE atribucion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid REFERENCES persona (id) ON DELETE RESTRICT,
  solicitud_id   uuid,
  canal          text NOT NULL CHECK (canal IN ('meta_ads', 'instagram', 'whatsapp', 'web_directa', 'referido', 'circuito', 'otro')),
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  fbclid         text,
  fbc            text,   -- solo si hay consentimiento de cookies
  fbp            text,   -- solo si hay consentimiento de cookies
  landing_path   text,
  referrer       text,
  capturada_en   timestamptz NOT NULL DEFAULT now(),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT atribucion_destino CHECK (persona_id IS NOT NULL OR solicitud_id IS NOT NULL)
);

-- =========================================================================================
-- oportunidad (embudo comercial; FK a temporada en 0002)
-- =========================================================================================
CREATE TABLE oportunidad (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  temporada_id      uuid NOT NULL,
  etapa             text NOT NULL DEFAULT 'nueva'
                      CHECK (etapa IN ('nueva', 'contactada', 'interesada', 'ganada', 'perdida', 'sin_respuesta')),
  origen            text NOT NULL CHECK (origen IN ('formulario_web', 'alta_manual')),
  proxima_accion    text,
  proxima_accion_en timestamptz,
  motivo_perdida    text,
  cerrada_en        timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (persona_id, temporada_id),
  CONSTRAINT oportunidad_motivo_perdida CHECK (etapa <> 'perdida' OR motivo_perdida IS NOT NULL)
);

-- Transiciones de oportunidad: nueva → contactada → interesada → ganada (automático al primer pago, desde
-- cualquier abierta). Desde cualquier abierta → perdida (con motivo) o sin_respuesta. Las cerradas sin ganar
-- pueden volver a contactada.
CREATE OR REPLACE FUNCTION transicion_oportunidad() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.etapa = OLD.etapa THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('oportunidad', CASE WHEN TG_OP = 'UPDATE' THEN OLD.etapa END, NEW.etapa, ARRAY[
    '(nuevo)>nueva',
    'nueva>contactada', 'contactada>interesada',
    'nueva>ganada', 'contactada>ganada', 'interesada>ganada',
    'nueva>perdida', 'contactada>perdida', 'interesada>perdida',
    'nueva>sin_respuesta', 'contactada>sin_respuesta', 'interesada>sin_respuesta',
    'perdida>contactada', 'sin_respuesta>contactada']);
  NEW.cerrada_en := CASE WHEN NEW.etapa IN ('ganada', 'perdida', 'sin_respuesta') THEN now() END;
  RETURN NEW;
END
$$;
CREATE TRIGGER oportunidad_transicion BEFORE INSERT OR UPDATE OF etapa ON oportunidad
  FOR EACH ROW EXECUTE FUNCTION transicion_oportunidad();

-- =========================================================================================
-- interaccion (línea de tiempo; FK a admin en 0004)
-- =========================================================================================
CREATE TABLE interaccion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  oportunidad_id uuid REFERENCES oportunidad (id) ON DELETE RESTRICT,
  tipo           text NOT NULL CHECK (tipo IN ('nota', 'llamada', 'whatsapp_entrante', 'whatsapp_saliente', 'instagram', 'email', 'presencial')),
  resumen        text NOT NULL,
  ocurrida_en    timestamptz NOT NULL,
  admin_id       uuid,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

-- =========================================================================================
-- Índices (FK y búsquedas). persona.email y persona.telefono ya tienen índice por su UNIQUE.
-- =========================================================================================
CREATE INDEX dorsal_temporada_persona_idx ON dorsal_temporada (persona_id);
CREATE INDEX tutela_tutor_idx             ON tutela (tutor_persona_id);
CREATE INDEX atribucion_persona_idx       ON atribucion (persona_id);
CREATE INDEX atribucion_solicitud_idx     ON atribucion (solicitud_id);
CREATE INDEX atribucion_campana_idx       ON atribucion (utm_campaign);
CREATE INDEX oportunidad_temporada_idx    ON oportunidad (temporada_id);
CREATE INDEX oportunidad_etapa_idx        ON oportunidad (etapa, proxima_accion_en);
CREATE INDEX interaccion_persona_idx      ON interaccion (persona_id, ocurrida_en DESC);
CREATE INDEX interaccion_oportunidad_idx  ON interaccion (oportunidad_id);
CREATE INDEX interaccion_admin_idx        ON interaccion (admin_id);
CREATE INDEX persona_nombre_idx           ON persona (lower(nombre), lower(apellidos));

-- =========================================================================================
-- actualizado_en e historial
-- =========================================================================================
CREATE TRIGGER persona_actualizado_en                BEFORE UPDATE ON persona                FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER perfil_piloto_actualizado_en          BEFORE UPDATE ON perfil_piloto          FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER dorsal_temporada_actualizado_en       BEFORE UPDATE ON dorsal_temporada       FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER datos_sensibles_piloto_actualizado_en BEFORE UPDATE ON datos_sensibles_piloto FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER tutela_actualizado_en                 BEFORE UPDATE ON tutela                 FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER atribucion_actualizado_en             BEFORE UPDATE ON atribucion             FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER oportunidad_actualizado_en            BEFORE UPDATE ON oportunidad            FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER interaccion_actualizado_en            BEFORE UPDATE ON interaccion            FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER persona_evento     AFTER INSERT OR UPDATE ON persona     FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado');
CREATE TRIGGER oportunidad_evento AFTER INSERT OR UPDATE ON oportunidad FOR EACH ROW EXECUTE FUNCTION registrar_evento('etapa');
