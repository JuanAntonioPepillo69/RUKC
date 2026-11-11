-- 0010 · Bot de WhatsApp (fase 1): 11 tablas nuevas (wa_*, kb_*, admin_actions, bot_settings) y 6 columnas nuevas.
-- Especificación: "RUKC – Especificación del bot de WhatsApp", sección 3b.
-- Solo añade: no cambia ni borra nada de lo existente. Las tablas nuevas siguen los nombres de la especificación
-- (id uuid, created_at y updated_at); las de v1.0 siguen con creado_en / actualizado_en.
-- Claves foráneas adaptadas al esquema v1.0: el lead es persona + oportunidad, las rondas son `ronda` y las
-- inscripciones `inscripcion`.

-- Fecha de actualización de las tablas nuevas (equivalente a set_actualizado_en para la columna updated_at).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- =========================================================================================
-- Columnas nuevas en tablas existentes (todas admiten nulo o tienen valor por defecto)
-- =========================================================================================
ALTER TABLE ronda ADD COLUMN hora_acreditacion time;
ALTER TABLE ronda ADD COLUMN hora_briefing     time;
ALTER TABLE ronda ADD COLUMN maps_url          text;
ALTER TABLE ronda ADD COLUMN feedback_url      text;

-- El teléfono de contacto de un menor es el del tutor (persona/tutela de v1.0); estas dos columnas lo marcan en la
-- propia inscripción para los envíos (la variante de tutor de las plantillas).
ALTER TABLE inscripcion ADD COLUMN es_menor     boolean NOT NULL DEFAULT false;
ALTER TABLE inscripcion ADD COLUMN tutor_nombre text;
ALTER TABLE inscripcion ADD CONSTRAINT inscripcion_tutor_nombre CHECK (es_menor OR tutor_nombre IS NULL);

-- =========================================================================================
-- 1. wa_contacts: un registro por número de WhatsApp
-- =========================================================================================
CREATE TABLE wa_contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164            text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name          text,
  rol                   text NOT NULL DEFAULT 'lead' CHECK (rol IN ('lead', 'piloto', 'tutor', 'admin')),
  persona_id            uuid REFERENCES persona (id) ON DELETE SET NULL,
  lead_id               uuid REFERENCES oportunidad (id) ON DELETE SET NULL,
  inscripcion_id_ultima uuid REFERENCES inscripcion (id) ON DELETE SET NULL,
  last_inbound_at       timestamptz,          -- ventana de 24 h
  ai_disclosed_at       timestamptz,          -- primer mensaje con el aviso de IA
  modo                  text NOT NULL DEFAULT 'bot' CHECK (modo IN ('bot', 'humano', 'pausado')),
  modo_hasta            timestamptz,          -- nulo: sin fecha de fin
  baja                  text NOT NULL DEFAULT 'ninguna' CHECK (baja IN ('ninguna', 'comercial', 'total')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_contacts_persona_idx ON wa_contacts (persona_id);

-- =========================================================================================
-- 2. wa_consents: solo de alta. El estado vigente es el último registro por contacto y tipo.
-- =========================================================================================
CREATE TABLE wa_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES wa_contacts (id) ON DELETE RESTRICT,
  tipo          text NOT NULL CHECK (tipo IN ('operativo', 'comercial')),
  accion        text NOT NULL CHECK (accion IN ('otorga', 'revoca')),
  fuente        text NOT NULL CHECK (fuente IN ('formulario_web', 'whatsapp', 'admin')),
  otorgado_por  text NOT NULL DEFAULT 'titular' CHECK (otorgado_por IN ('titular', 'tutor')),
  texto_version text NOT NULL,
  evidencia     text,                         -- id del envío del formulario o del mensaje
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_consents_vigente_idx ON wa_consents (contact_id, tipo, created_at DESC);

-- =========================================================================================
-- 3. wa_conversations
-- =========================================================================================
CREATE TABLE wa_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        uuid NOT NULL REFERENCES wa_contacts (id) ON DELETE RESTRICT,
  estado            text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'escalada', 'cerrada')),
  abierta_at        timestamptz NOT NULL DEFAULT now(),
  ultimo_mensaje_at timestamptz NOT NULL DEFAULT now(),
  motivo_escalado   text,
  resumen           text,                     -- lo escribe Haiku al escalar o cerrar
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_conversations_contact_idx ON wa_conversations (contact_id, ultimo_mensaje_at DESC);
CREATE INDEX wa_conversations_estado_idx  ON wa_conversations (estado);

-- =========================================================================================
-- 6. wa_batches (antes que wa_outbox, que la referencia)
-- =========================================================================================
CREATE TABLE wa_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automatizacion     text NOT NULL CHECK (automatizacion IN ('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'D1', 'D2', 'D3', 'E1', 'F1', 'F2')),
  ronda_id           uuid REFERENCES ronda (id) ON DELETE RESTRICT,
  num_destinatarios  integer NOT NULL DEFAULT 0 CHECK (num_destinatarios >= 0),
  vista_previa       text,
  codigo             text CHECK (codigo ~ '^[0-9]{4}$'),
  confirmar_antes_de timestamptz,
  confirmado_at      timestamptz,
  estado             text NOT NULL DEFAULT 'propuesto' CHECK (estado IN ('propuesto', 'confirmado', 'caducado', 'cancelado', 'enviado')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_batches_ronda_idx ON wa_batches (ronda_id);

-- =========================================================================================
-- 4. wa_messages
-- =========================================================================================
CREATE TABLE wa_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid REFERENCES wa_conversations (id) ON DELETE RESTRICT,
  contact_id          uuid NOT NULL REFERENCES wa_contacts (id) ON DELETE RESTRICT,
  direccion           text NOT NULL CHECK (direccion IN ('entrada', 'salida')),
  autor               text NOT NULL CHECK (autor IN ('usuario', 'bot', 'john_app', 'john_admin', 'sistema')),
  tipo                text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'plantilla', 'interactivo', 'media')),
  plantilla           text,
  cuerpo              text,
  provider_message_id text UNIQUE,            -- id de YCloud (entrantes y salientes)
  wamid               text,
  estado              text CHECK (estado IN ('aceptado', 'enviado', 'entregado', 'leido', 'fallido')),  -- solo salidas
  error_code          text,
  categoria_precio    text,
  facturable          boolean,
  raw                 jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_messages_conversation_idx ON wa_messages (conversation_id, created_at);
CREATE INDEX wa_messages_contact_idx      ON wa_messages (contact_id, created_at DESC);
CREATE INDEX wa_messages_wamid_idx        ON wa_messages (wamid);

-- =========================================================================================
-- 5. wa_outbox: cola de envíos programados (la usa la fase 3)
-- =========================================================================================
CREATE TABLE wa_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES wa_contacts (id) ON DELETE RESTRICT,
  lote_id         uuid REFERENCES wa_batches (id) ON DELETE RESTRICT,   -- nulo si es individual
  automatizacion  text NOT NULL CHECK (automatizacion IN ('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'D1', 'D2', 'D3', 'E1', 'F1', 'F2')),
  ronda_id        uuid REFERENCES ronda (id) ON DELETE RESTRICT,
  plantilla       text,
  idioma          text NOT NULL DEFAULT 'es',
  variables       jsonb NOT NULL DEFAULT '{}'::jsonb,
  enviar_at       timestamptz NOT NULL,
  estado          text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'pendiente_confirmacion', 'confirmado', 'enviando', 'enviado', 'fallido', 'cancelado', 'caducado')),
  intentos        smallint NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error    text,
  idempotency_key text NOT NULL UNIQUE,       -- p. ej. D1:R3:+34600112233
  message_id      uuid REFERENCES wa_messages (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_outbox_pendientes_idx ON wa_outbox (estado, enviar_at);
CREATE INDEX wa_outbox_contact_idx    ON wa_outbox (contact_id);
CREATE INDEX wa_outbox_lote_idx       ON wa_outbox (lote_id);

-- =========================================================================================
-- 7. wa_webhook_events: idempotencia de los avisos de YCloud
-- =========================================================================================
CREATE TABLE wa_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  tipo              text NOT NULL,
  recibido_at       timestamptz NOT NULL DEFAULT now(),
  procesado_at      timestamptz,
  estado            text NOT NULL DEFAULT 'recibido' CHECK (estado IN ('recibido', 'procesado', 'error')),
  error             text,
  payload           jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_webhook_events_estado_idx ON wa_webhook_events (estado, recibido_at);

-- =========================================================================================
-- 8. kb_documents y 10. kb_document_versions: base de conocimiento con historial de versiones
-- =========================================================================================
CREATE TABLE kb_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]+$'),
  titulo          text NOT NULL,
  categoria       text NOT NULL CHECK (categoria IN ('liga', 'categorias', 'calendario', 'precios', 'politicas', 'reglamento',
                                                     'dia_de_carrera', 'menores', 'enlaces', 'faq')),
  contenido_md    text NOT NULL,
  fuente          text NOT NULL CHECK (fuente IN ('web', 'john', 'reglamento')),
  url_fuente      text,
  vigente_hasta   timestamptz,                -- nulo si no caduca
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  activo          boolean NOT NULL DEFAULT true,
  actualizado_por text NOT NULL DEFAULT 'sistema',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_document_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES kb_documents (id) ON DELETE RESTRICT,
  slug            text NOT NULL,
  titulo          text NOT NULL,
  categoria       text NOT NULL,
  contenido_md    text NOT NULL,
  fuente          text NOT NULL,
  url_fuente      text,
  vigente_hasta   timestamptz,
  version         integer NOT NULL,
  activo          boolean NOT NULL,
  actualizado_por text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

-- Cada cambio de contenido, título, categoría, fuente, vigencia o estado guarda la versión anterior y sube `version`.
CREATE OR REPLACE FUNCTION kb_versionar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.contenido_md, OLD.titulo, OLD.categoria, OLD.fuente, OLD.url_fuente, OLD.vigente_hasta, OLD.activo)
     IS NOT DISTINCT FROM (NEW.contenido_md, NEW.titulo, NEW.categoria, NEW.fuente, NEW.url_fuente, NEW.vigente_hasta, NEW.activo) THEN
    RETURN NEW;
  END IF;
  INSERT INTO kb_document_versions (document_id, slug, titulo, categoria, contenido_md, fuente, url_fuente, vigente_hasta,
                                    version, activo, actualizado_por)
  VALUES (OLD.id, OLD.slug, OLD.titulo, OLD.categoria, OLD.contenido_md, OLD.fuente, OLD.url_fuente, OLD.vigente_hasta,
          OLD.version, OLD.activo, OLD.actualizado_por);
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER kb_documents_versionar BEFORE UPDATE ON kb_documents
  FOR EACH ROW EXECUTE FUNCTION kb_versionar();

-- =========================================================================================
-- 9. admin_actions: propuestas del canal admin con código de un solo uso (las usa la fase 2)
-- =========================================================================================
CREATE TABLE admin_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto_original  text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('enviar_lote', 'confirmar_bizum', 'actualizar_kb', 'responder', 'pausar', 'otra')),
  parametros      jsonb NOT NULL DEFAULT '{}'::jsonb,
  codigo          text CHECK (codigo ~ '^[0-9]{4}$'),
  caduca_at       timestamptz,
  estado          text NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta', 'confirmada', 'ejecutada', 'cancelada', 'caducada')),
  resultado       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_estado_idx ON admin_actions (estado, caduca_at);

-- =========================================================================================
-- 11. bot_settings: configuración clave-valor
-- =========================================================================================
CREATE TABLE bot_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave      text NOT NULL UNIQUE,
  valor      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bot_settings (clave, valor) VALUES
  ('grupo_invite_code',   NULL),
  ('horario_inicio',      '09:30'),
  ('horario_fin',         '21:30'),
  ('bot_activo',          'true'),
  ('modelo_conversacion', 'claude-sonnet-5-5'),
  ('modelo_clasificador', 'claude-haiku-5-5');

-- =========================================================================================
-- updated_at
-- =========================================================================================
CREATE TRIGGER wa_contacts_updated_at          BEFORE UPDATE ON wa_contacts          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_consents_updated_at          BEFORE UPDATE ON wa_consents          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_conversations_updated_at     BEFORE UPDATE ON wa_conversations     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_messages_updated_at          BEFORE UPDATE ON wa_messages          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_outbox_updated_at            BEFORE UPDATE ON wa_outbox            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_batches_updated_at           BEFORE UPDATE ON wa_batches           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wa_webhook_events_updated_at    BEFORE UPDATE ON wa_webhook_events    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER kb_documents_updated_at         BEFORE UPDATE ON kb_documents         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER kb_document_versions_updated_at BEFORE UPDATE ON kb_document_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_actions_updated_at        BEFORE UPDATE ON admin_actions        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bot_settings_updated_at         BEFORE UPDATE ON bot_settings         FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================================
-- Permisos de rukc_app (los de negocio llegan por los privilegios por defecto de 0006). Excepciones:
-- =========================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON wa_contacts, wa_consents, wa_conversations, wa_messages, wa_outbox, wa_batches,
  wa_webhook_events, kb_documents, kb_document_versions, admin_actions, bot_settings TO rukc_app;
-- Consentimientos e historial de la base de conocimiento: solo leer y añadir.
REVOKE UPDATE, DELETE, TRUNCATE ON wa_consents FROM rukc_app;
REVOKE UPDATE, DELETE, TRUNCATE ON kb_document_versions FROM rukc_app;
