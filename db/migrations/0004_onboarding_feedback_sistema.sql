-- 0004 · Onboarding, documentos legales y aceptaciones, acceso al grupo, formación, pesaje, feedback y tablas de sistema.
-- Diseño: docs/base-datos/diseno-v1.0.md, "Tablas: onboarding, feedback y sistema" y "Estados y transiciones".

-- =========================================================================================
-- admin (usuarios del panel; el login va sobre las tablas de Better Auth, fase 3)
-- =========================================================================================
CREATE TABLE admin (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  nombre         text NOT NULL,
  rol            text NOT NULL CHECK (rol IN ('propietario', 'operador')),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

ALTER TABLE interaccion ADD CONSTRAINT interaccion_admin_fk
  FOREIGN KEY (admin_id) REFERENCES admin (id) ON DELETE RESTRICT;

-- =========================================================================================
-- documento_legal: versiones; cada una solo se activa con fecha de revisión del abogado
-- =========================================================================================
CREATE TABLE documento_legal (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                   text NOT NULL CHECK (tipo IN ('asuncion_riesgos', 'cesion_imagen', 'reglamento', 'privacidad',
                                                       'condiciones_reserva', 'consentimiento_peso', 'aviso_borradores')),
  version                text NOT NULL,
  titulo                 text NOT NULL,
  contenido_md           text NOT NULL,
  hash_sha256            text NOT NULL,   -- del contenido exacto (lo calcula el trigger)
  vigente_desde          timestamptz,
  vigente_hasta          timestamptz,
  obligatorio_onboarding boolean NOT NULL DEFAULT false,
  revocable              boolean NOT NULL DEFAULT false,   -- imagen y peso sí; riesgos y reglamento no
  revisado_abogado_en    date,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  actualizado_en         timestamptz NOT NULL DEFAULT now(),
  creado_por             text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (tipo, version),
  CONSTRAINT documento_activacion CHECK (vigente_desde IS NULL OR revisado_abogado_en IS NOT NULL),
  CONSTRAINT documento_fechas CHECK (vigente_hasta IS NULL OR (vigente_desde IS NOT NULL AND vigente_hasta > vigente_desde)),
  -- Una vigente por tipo: los periodos de vigencia de un mismo tipo no se solapan.
  CONSTRAINT documento_una_vigente EXCLUDE USING gist (tipo WITH =, tstzrange(vigente_desde, vigente_hasta) WITH &&)
    WHERE (vigente_desde IS NOT NULL)
);

-- Hash del contenido exacto; un documento activado o ya aceptado no cambia de contenido (se crea otra versión).
CREATE OR REPLACE FUNCTION preparar_documento_legal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tipo, NEW.version, NEW.titulo, NEW.contenido_md)
                          IS DISTINCT FROM (OLD.tipo, OLD.version, OLD.titulo, OLD.contenido_md)
     AND (OLD.vigente_desde IS NOT NULL OR EXISTS (SELECT 1 FROM aceptacion WHERE documento_legal_id = OLD.id)) THEN
    RAISE EXCEPTION 'Un documento activado o aceptado no se edita: crea una versión nueva' USING ERRCODE = 'check_violation';
  END IF;
  NEW.hash_sha256 := encode(digest(NEW.contenido_md, 'sha256'), 'hex');
  RETURN NEW;
END
$$;

-- =========================================================================================
-- aceptacion: solo se inserta; la única columna modificable es revocada_en
-- =========================================================================================
CREATE TABLE aceptacion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id          uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,   -- titular (el piloto)
  firmante_persona_id uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,   -- el piloto o su tutor
  documento_legal_id  uuid NOT NULL REFERENCES documento_legal (id) ON DELETE RESTRICT,   -- versión exacta
  aceptado            boolean NOT NULL,     -- en cesión de imagen puede ser false
  opciones            jsonb,                -- imagen: web, redes, anuncios por separado
  contexto            text NOT NULL CHECK (contexto IN ('formulario_web', 'onboarding', 'acreditacion_ronda', 'manual')),
  ronda_id            uuid REFERENCES ronda (id) ON DELETE RESTRICT,   -- en ratificaciones por ronda
  nombre_tecleado     text,
  documento_ultimos3  text CHECK (char_length(documento_ultimos3) = 3),
  documento_hash      text,
  ip                  text,
  user_agent          text,
  aceptada_en         timestamptz NOT NULL DEFAULT now(),
  revocada_en         timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

CREATE TRIGGER documento_legal_preparar BEFORE INSERT OR UPDATE ON documento_legal
  FOR EACH ROW EXECUTE FUNCTION preparar_documento_legal();

-- Al insertar: el documento tiene que estar vigente y el hash de la evidencia es el del documento.
-- Al actualizar: solo se puede fijar revocada_en, una vez, y solo en documentos revocables. Nunca se borra.
CREATE OR REPLACE FUNCTION proteger_aceptacion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d documento_legal;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las aceptaciones no se borran' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM documento_legal WHERE id = NEW.documento_legal_id;
  IF TG_OP = 'INSERT' THEN
    IF d.vigente_desde IS NULL OR d.vigente_desde > now() OR (d.vigente_hasta IS NOT NULL AND d.vigente_hasta <= now()) THEN
      RAISE EXCEPTION 'Solo se puede aceptar una versión vigente del documento (% %)', d.tipo, d.version USING ERRCODE = 'check_violation';
    END IF;
    NEW.documento_hash := d.hash_sha256;
    IF NEW.revocada_en IS NOT NULL THEN
      RAISE EXCEPTION 'Una aceptación nueva no puede nacer revocada' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'revocada_en' - 'actualizado_en') IS DISTINCT FROM (to_jsonb(OLD) - 'revocada_en' - 'actualizado_en') THEN
    RAISE EXCEPTION 'Una aceptación no se edita; solo se puede revocar' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revocada_en IS DISTINCT FROM OLD.revocada_en THEN
    IF OLD.revocada_en IS NOT NULL OR NEW.revocada_en IS NULL THEN
      RAISE EXCEPTION 'Una revocación no se deshace ni se cambia' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT d.revocable THEN
      RAISE EXCEPTION 'El documento % no es revocable', d.tipo USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aceptacion_proteger BEFORE INSERT OR UPDATE OR DELETE ON aceptacion
  FOR EACH ROW EXECUTE FUNCTION proteger_aceptacion();

-- El peso declarado exige un consentimiento de peso vigente y no revocado.
CREATE OR REPLACE FUNCTION exigir_consentimiento_peso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.peso_declarado_kg IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.peso_declarado_kg IS DISTINCT FROM OLD.peso_declarado_kg)
     AND NOT EXISTS (
       SELECT 1 FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id
       WHERE a.persona_id = NEW.persona_id AND d.tipo = 'consentimiento_peso' AND a.aceptado AND a.revocada_en IS NULL) THEN
    RAISE EXCEPTION 'Para guardar el peso hace falta el consentimiento de peso vigente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER datos_sensibles_peso BEFORE INSERT OR UPDATE OF peso_declarado_kg ON datos_sensibles_piloto
  FOR EACH ROW EXECUTE FUNCTION exigir_consentimiento_peso();

-- =========================================================================================
-- onboarding
-- =========================================================================================
CREATE TABLE onboarding (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  temporada_id      uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  estado            text NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'en_curso', 'falta_tutor', 'completado', 'requiere_actualizacion')),
  token_hash        text NOT NULL UNIQUE,   -- solo el hash SHA-256 del enlace personal
  token_expira_en   timestamptz NOT NULL,   -- fin de temporada
  paso_actual       smallint,
  borrador          jsonb,                  -- autoguardado entre pasos
  enlace_enviado_en timestamptz,
  iniciado_en       timestamptz,
  completado_en     timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (persona_id, temporada_id)
);

CREATE OR REPLACE FUNCTION transicion_onboarding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('onboarding', CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado, ARRAY[
    '(nuevo)>pendiente',
    'pendiente>en_curso', 'en_curso>falta_tutor', 'falta_tutor>en_curso', 'en_curso>completado',
    'completado>requiere_actualizacion', 'requiere_actualizacion>completado']);
  IF NEW.estado = 'en_curso' THEN NEW.iniciado_en := coalesce(NEW.iniciado_en, now()); END IF;
  IF NEW.estado = 'completado' THEN NEW.completado_en := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER onboarding_transicion BEFORE INSERT OR UPDATE OF estado ON onboarding
  FOR EACH ROW EXECUTE FUNCTION transicion_onboarding();

-- =========================================================================================
-- acceso_grupo (grupo de WhatsApp de pilotos)
-- =========================================================================================
CREATE TABLE acceso_grupo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  temporada_id      uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  estado            text NOT NULL DEFAULT 'pendiente_aprobacion'
                      CHECK (estado IN ('pendiente_aprobacion', 'aprobado', 'rechazado', 'enlace_enviado', 'dentro', 'fuera')),
  solicitado_en     timestamptz NOT NULL DEFAULT now(),
  decidido_en       timestamptz,
  decidido_por      uuid REFERENCES admin (id) ON DELETE RESTRICT,
  motivo_rechazo    text,
  enlace_enviado_en timestamptz,
  dentro_en         timestamptz,
  salida_en         timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (persona_id, temporada_id),
  CONSTRAINT acceso_motivo_rechazo CHECK (estado <> 'rechazado' OR (motivo_rechazo IS NOT NULL AND btrim(motivo_rechazo) <> ''))
);

CREATE OR REPLACE FUNCTION transicion_acceso_grupo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('acceso_grupo', CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado, ARRAY[
    '(nuevo)>pendiente_aprobacion',
    'pendiente_aprobacion>aprobado', 'pendiente_aprobacion>rechazado', 'rechazado>pendiente_aprobacion',
    'aprobado>enlace_enviado', 'enlace_enviado>dentro', 'dentro>fuera']);
  CASE NEW.estado
    WHEN 'aprobado' THEN NEW.decidido_en := now();
    WHEN 'rechazado' THEN NEW.decidido_en := now();
    WHEN 'enlace_enviado' THEN NEW.enlace_enviado_en := now();
    WHEN 'dentro' THEN NEW.dentro_en := now();
    WHEN 'fuera' THEN NEW.salida_en := now();
    ELSE NULL;
  END CASE;
  RETURN NEW;
END
$$;
CREATE TRIGGER acceso_grupo_transicion BEFORE INSERT OR UPDATE OF estado ON acceso_grupo
  FOR EACH ROW EXECUTE FUNCTION transicion_acceso_grupo();

-- =========================================================================================
-- formación (borrador) y pesaje (preparado, sin pantalla en v1)
-- =========================================================================================
CREATE TABLE formacion_modulo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  titulo         text NOT NULL,
  url            text NOT NULL,
  orden          smallint NOT NULL DEFAULT 1,
  obligatorio    boolean NOT NULL DEFAULT false,
  activo         boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

CREATE TABLE formacion_progreso (
  persona_id     uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  modulo_id      uuid NOT NULL REFERENCES formacion_modulo (id) ON DELETE RESTRICT,
  visto_en       timestamptz NOT NULL DEFAULT now(),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  PRIMARY KEY (persona_id, modulo_id)
);

CREATE TABLE pesaje (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_id uuid NOT NULL UNIQUE REFERENCES inscripcion (id) ON DELETE RESTRICT,
  peso_kg        numeric(5,1) NOT NULL CHECK (peso_kg BETWEEN 30 AND 200),
  lastre_kg      numeric(5,1) NOT NULL DEFAULT 0 CHECK (lastre_kg BETWEEN 0 AND 100),
  categoria_id   uuid REFERENCES categoria (id) ON DELETE RESTRICT,   -- la que resulta del pesaje
  pesado_en      timestamptz NOT NULL DEFAULT now(),
  pesado_por     text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

-- =========================================================================================
-- feedback post-carrera
-- =========================================================================================
CREATE TABLE plantilla_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version        text NOT NULL UNIQUE,
  -- [{id, tipo (escala_0_10 · escala_1_5 · opcion_unica · opcion_multiple · texto), texto, obligatoria, opciones}]
  preguntas      jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(preguntas) = 'array'),
  activa         boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);
CREATE UNIQUE INDEX plantilla_feedback_una_activa ON plantilla_feedback ((true)) WHERE activa;

ALTER TABLE temporada ADD CONSTRAINT temporada_plantilla_fk
  FOREIGN KEY (plantilla_feedback_id) REFERENCES plantilla_feedback (id) ON DELETE RESTRICT;

CREATE TABLE envio_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_id  uuid NOT NULL UNIQUE REFERENCES inscripcion (id) ON DELETE RESTRICT,
  plantilla_id    uuid NOT NULL REFERENCES plantilla_feedback (id) ON DELETE RESTRICT,
  estado          text NOT NULL DEFAULT 'generado' CHECK (estado IN ('generado', 'enviado', 'abierto', 'respondido', 'caducado')),
  token_hash      text NOT NULL UNIQUE,
  enviado_en      timestamptz,
  canal           text,
  abierto_en      timestamptz,
  respondido_en   timestamptz,
  recordatorio_en timestamptz,
  expira_en       timestamptz NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

-- Una plantilla usada no se edita: se crea otra versión.
CREATE OR REPLACE FUNCTION proteger_plantilla_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.version, NEW.preguntas) IS DISTINCT FROM (OLD.version, OLD.preguntas)
     AND EXISTS (SELECT 1 FROM envio_feedback WHERE plantilla_id = OLD.id) THEN
    RAISE EXCEPTION 'Esta plantilla ya se ha usado: duplícala como versión nueva' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER plantilla_feedback_proteger BEFORE UPDATE ON plantilla_feedback
  FOR EACH ROW EXECUTE FUNCTION proteger_plantilla_feedback();

-- Solo se genera feedback para inscripciones en asistio; transiciones del envío.
CREATE OR REPLACE FUNCTION transicion_envio_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT estado FROM inscripcion WHERE id = NEW.inscripcion_id) <> 'asistio' THEN
    RAISE EXCEPTION 'Solo se genera feedback para inscripciones en asistio' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('envio_feedback', CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado, ARRAY[
    '(nuevo)>generado',
    'generado>enviado', 'enviado>abierto', 'enviado>respondido', 'abierto>respondido',
    'generado>caducado', 'enviado>caducado', 'abierto>caducado']);
  CASE NEW.estado
    WHEN 'enviado' THEN NEW.enviado_en := coalesce(NEW.enviado_en, now());
    WHEN 'abierto' THEN NEW.abierto_en := coalesce(NEW.abierto_en, now());
    WHEN 'respondido' THEN NEW.respondido_en := now();
    ELSE NULL;
  END CASE;
  RETURN NEW;
END
$$;
CREATE TRIGGER envio_feedback_transicion BEFORE INSERT OR UPDATE OF estado ON envio_feedback
  FOR EACH ROW EXECUTE FUNCTION transicion_envio_feedback();

-- Una fila por pregunta, para poder filtrar por respuesta.
CREATE TABLE respuesta_feedback (
  envio_id       uuid NOT NULL REFERENCES envio_feedback (id) ON DELETE RESTRICT,
  pregunta_id    text NOT NULL,
  valor_num      numeric,
  valor_texto    text,
  valor_opciones text[],
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'publico' CHECK (creado_por_valido(creado_por)),
  PRIMARY KEY (envio_id, pregunta_id)
);

-- =========================================================================================
-- consentimientos fuera de documentos, derechos RGPD, vistas guardadas y límite de peticiones
-- =========================================================================================
CREATE TABLE consentimiento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  finalidad      text NOT NULL CHECK (finalidad IN ('comunicaciones_comerciales', 'medicion_anuncios')),
  otorgado       boolean NOT NULL,
  origen         text NOT NULL,   -- dónde se dio: formulario_web, onboarding, alta_manual...
  registrado_en  timestamptz NOT NULL DEFAULT now(),
  revocado_en    timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

CREATE TABLE solicitud_rgpd (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid REFERENCES persona (id) ON DELETE RESTRICT,
  contacto       text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('acceso', 'rectificacion', 'supresion', 'oposicion', 'limitacion', 'portabilidad', 'retirada_consentimiento')),
  recibida_en    timestamptz NOT NULL DEFAULT now(),
  vence_en       timestamptz NOT NULL,   -- recibida + 1 mes (lo pone el trigger si no viene)
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'resuelta', 'rechazada')),
  resolucion     text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT rgpd_resolucion CHECK (estado = 'pendiente' OR resolucion IS NOT NULL)
);

CREATE OR REPLACE FUNCTION preparar_solicitud_rgpd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.vence_en := coalesce(NEW.vence_en, NEW.recibida_en + interval '1 month');
  RETURN NEW;
END
$$;
CREATE TRIGGER solicitud_rgpd_preparar BEFORE INSERT ON solicitud_rgpd
  FOR EACH ROW EXECUTE FUNCTION preparar_solicitud_rgpd();

CREATE TABLE vista_guardada (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       uuid NOT NULL REFERENCES admin (id) ON DELETE RESTRICT,
  pantalla       text NOT NULL,
  nombre         text NOT NULL,
  filtros        jsonb NOT NULL DEFAULT '{}',
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  UNIQUE (admin_id, pantalla, nombre)
);

-- Freno a abusos en formularios públicos (20 peticiones por IP y ruta cada 10 min).
CREATE TABLE limite_peticion (
  clave          text NOT NULL,   -- ip_hash + ruta
  ventana_inicio timestamptz NOT NULL,
  contador       integer NOT NULL DEFAULT 1 CHECK (contador >= 0),
  PRIMARY KEY (clave, ventana_inicio)
);

-- =========================================================================================
-- evento: solo se añade. Nadie lo modifica ni lo borra (ni siquiera el propietario por error).
-- =========================================================================================
CREATE OR REPLACE FUNCTION proteger_evento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial (evento) solo admite añadir filas' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER evento_proteger BEFORE UPDATE OR DELETE ON evento
  FOR EACH ROW EXECUTE FUNCTION proteger_evento();
CREATE TRIGGER evento_proteger_truncate BEFORE TRUNCATE ON evento
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_evento();

-- =========================================================================================
-- Índices
-- =========================================================================================
CREATE INDEX aceptacion_persona_idx     ON aceptacion (persona_id);
CREATE INDEX aceptacion_firmante_idx    ON aceptacion (firmante_persona_id);
CREATE INDEX aceptacion_documento_idx   ON aceptacion (documento_legal_id);
CREATE INDEX aceptacion_ronda_idx       ON aceptacion (ronda_id);
CREATE INDEX onboarding_temporada_idx   ON onboarding (temporada_id, estado);
CREATE INDEX acceso_grupo_temporada_idx ON acceso_grupo (temporada_id, estado);
CREATE INDEX acceso_grupo_decidido_idx  ON acceso_grupo (decidido_por);
CREATE INDEX formacion_modulo_temp_idx  ON formacion_modulo (temporada_id);
CREATE INDEX formacion_progreso_mod_idx ON formacion_progreso (modulo_id);
CREATE INDEX pesaje_categoria_idx       ON pesaje (categoria_id);
CREATE INDEX envio_feedback_plant_idx   ON envio_feedback (plantilla_id);
CREATE INDEX envio_feedback_estado_idx  ON envio_feedback (estado, expira_en);
CREATE INDEX consentimiento_persona_idx ON consentimiento (persona_id, finalidad);
CREATE INDEX solicitud_rgpd_persona_idx ON solicitud_rgpd (persona_id);
CREATE INDEX solicitud_rgpd_estado_idx  ON solicitud_rgpd (estado, vence_en);
CREATE INDEX evento_actor_idx           ON evento (actor, ocurrido_en);

-- =========================================================================================
-- actualizado_en e historial
-- =========================================================================================
CREATE TRIGGER admin_actualizado_en              BEFORE UPDATE ON admin              FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER documento_legal_actualizado_en    BEFORE UPDATE ON documento_legal    FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER aceptacion_actualizado_en         BEFORE UPDATE ON aceptacion         FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER onboarding_actualizado_en         BEFORE UPDATE ON onboarding         FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER acceso_grupo_actualizado_en       BEFORE UPDATE ON acceso_grupo       FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER formacion_modulo_actualizado_en   BEFORE UPDATE ON formacion_modulo   FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER formacion_progreso_actualizado_en BEFORE UPDATE ON formacion_progreso FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER pesaje_actualizado_en             BEFORE UPDATE ON pesaje             FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER plantilla_feedback_actualizado_en BEFORE UPDATE ON plantilla_feedback FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER envio_feedback_actualizado_en     BEFORE UPDATE ON envio_feedback     FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER respuesta_feedback_actualizado_en BEFORE UPDATE ON respuesta_feedback FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER consentimiento_actualizado_en     BEFORE UPDATE ON consentimiento     FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER solicitud_rgpd_actualizado_en     BEFORE UPDATE ON solicitud_rgpd     FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER vista_guardada_actualizado_en     BEFORE UPDATE ON vista_guardada     FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER admin_evento           AFTER INSERT OR UPDATE ON admin           FOR EACH ROW EXECUTE FUNCTION registrar_evento('rol,activo');
CREATE TRIGGER documento_legal_evento AFTER INSERT OR UPDATE ON documento_legal FOR EACH ROW EXECUTE FUNCTION registrar_evento('tipo,version,hash_sha256,vigente_desde,vigente_hasta,revisado_abogado_en');
CREATE TRIGGER aceptacion_evento      AFTER INSERT OR UPDATE ON aceptacion      FOR EACH ROW EXECUTE FUNCTION registrar_evento('documento_legal_id,aceptado,opciones,contexto,revocada_en');
CREATE TRIGGER consentimiento_evento  AFTER INSERT OR UPDATE ON consentimiento  FOR EACH ROW EXECUTE FUNCTION registrar_evento('finalidad,otorgado,revocado_en');
CREATE TRIGGER onboarding_evento      AFTER INSERT OR UPDATE ON onboarding      FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado');
CREATE TRIGGER acceso_grupo_evento    AFTER INSERT OR UPDATE ON acceso_grupo    FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado');
CREATE TRIGGER envio_feedback_evento  AFTER INSERT OR UPDATE ON envio_feedback  FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado');
CREATE TRIGGER solicitud_rgpd_evento  AFTER INSERT OR UPDATE ON solicitud_rgpd  FOR EACH ROW EXECUTE FUNCTION registrar_evento('tipo,estado');
