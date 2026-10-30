-- 0003 · Venta y dinero: solicitudes del formulario, pedidos, inscripciones, pagos, aplicaciones, créditos,
-- reembolsos, traslados, entidad cobradora y eventos de Stripe.
-- Diseño: docs/base-datos/diseno-v1.0.md, "Tablas: venta y dinero" y "Estados y transiciones".
--
-- Cómo cuadra el dinero:
-- - Un pago se reparte entre inscripciones con aplicacion_pago. Solo cuentan los pagos confirmados
--   (o reembolsados en parte), y lo aplicado nunca supera el importe del pago menos lo reembolsado.
-- - Los canjes de crédito (movimiento_credito tipo canje, importe negativo) también pagan inscripciones.
-- - Lo aplicado más lo canjeado en una inscripción nunca supera su precio.
-- - El estado de cobro de la inscripción (pendiente_pago · reservada · pagada) lo recalcula la base de datos
--   cada vez que cambian aplicaciones, pagos, créditos o el precio. No se puede poner a mano: solo se acepta
--   cuando el cambio viene de un trigger (pg_trigger_depth() > 1).

-- =========================================================================================
-- entidad_cobradora
-- =========================================================================================
CREATE TABLE entidad_cobradora (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_comercial text NOT NULL,
  titular_legal    text,
  nif              text,
  tipo             text CHECK (tipo IN ('persona_fisica', 'empresa', 'sociedad')),
  activa_desde     date,
  activa_hasta     date,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT entidad_fechas CHECK (activa_hasta IS NULL OR activa_desde IS NULL OR activa_hasta >= activa_desde)
);
-- Una sola activa para los cobros nuevos: la que no tiene fecha de fin.
CREATE UNIQUE INDEX entidad_cobradora_una_activa ON entidad_cobradora ((true)) WHERE activa_hasta IS NULL;

-- =========================================================================================
-- solicitud_inscripcion (embudo del formulario web)
-- =========================================================================================
CREATE TABLE solicitud_inscripcion (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                     text NOT NULL UNIQUE CHECK (codigo ~ '^RK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'),
  estado                     text NOT NULL DEFAULT 'borrador'
                               CHECK (estado IN ('borrador', 'enviada', 'pagada', 'pago_abandonado', 'descartada')),
  temporada_id               uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  ronda_id                   uuid REFERENCES ronda (id) ON DELETE RESTRICT,
  categoria_elegida          text CHECK (categoria_elegida IN ('LIG', 'PES', 'no_se')),
  pagador_nombre             text,
  pagador_email              text,
  pagador_telefono           text,
  piloto_es_pagador          boolean NOT NULL DEFAULT true,
  piloto_nombre              text,
  piloto_telefono            text,
  metodo_elegido             text CHECK (metodo_elegido IN ('tarjeta', 'bizum')),
  persona_id                 uuid REFERENCES persona (id) ON DELETE RESTRICT,
  borrador_token_hash        text UNIQUE,
  paso_actual                smallint,
  acepta_documentos          jsonb,
  acepta_comunicaciones      boolean NOT NULL DEFAULT false,
  consentimiento_medicion    boolean NOT NULL DEFAULT false,
  stripe_checkout_session_id text UNIQUE,
  checkout_expira_en         timestamptz,
  ultimo_guardado_en         timestamptz,
  enviada_en                 timestamptz,
  pagada_en                  timestamptz,
  abandonada_en              timestamptz,
  pedido_id                  uuid,
  ip_hash                    text,
  user_agent                 text,
  creado_en                  timestamptz NOT NULL DEFAULT now(),
  actualizado_en             timestamptz NOT NULL DEFAULT now(),
  creado_por                 text NOT NULL DEFAULT 'publico' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT solicitud_contacto CHECK (estado = 'descartada' OR pagador_email IS NOT NULL OR pagador_telefono IS NOT NULL),
  CONSTRAINT solicitud_ronda CHECK (estado IN ('borrador', 'descartada') OR ronda_id IS NOT NULL),
  CONSTRAINT solicitud_piloto CHECK (piloto_es_pagador OR estado IN ('borrador', 'descartada') OR piloto_nombre IS NOT NULL)
);

ALTER TABLE atribucion ADD CONSTRAINT atribucion_solicitud_fk
  FOREIGN KEY (solicitud_id) REFERENCES solicitud_inscripcion (id) ON DELETE RESTRICT;

-- Código RK-XXXX: 4 caracteres sin ambiguos (sin 0, O, 1, I). Es el concepto del Bizum.
CREATE OR REPLACE FUNCTION nuevo_codigo_solicitud() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
BEGIN
  LOOP
    SELECT 'RK-' || string_agg(substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1), '')
      INTO c FROM generate_series(1, 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM solicitud_inscripcion WHERE codigo = c);
  END LOOP;
  RETURN c;
END
$$;

CREATE OR REPLACE FUNCTION preparar_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS NULL THEN NEW.codigo := nuevo_codigo_solicitud(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER solicitud_preparar BEFORE INSERT ON solicitud_inscripcion
  FOR EACH ROW EXECUTE FUNCTION preparar_solicitud();

-- Transiciones de solicitud_inscripcion.
CREATE OR REPLACE FUNCTION transicion_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('solicitud_inscripcion', CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado, ARRAY[
    '(nuevo)>borrador',
    'borrador>enviada', 'enviada>pagada', 'enviada>pago_abandonado',
    'pago_abandonado>enviada', 'pago_abandonado>pagada',
    'borrador>descartada', 'pago_abandonado>descartada']);
  IF NEW.estado = 'enviada' AND (NEW.ronda_id IS NULL OR NEW.acepta_documentos IS NULL
                                 OR (NEW.pagador_email IS NULL AND NEW.pagador_telefono IS NULL)) THEN
    RAISE EXCEPTION 'Para enviar la solicitud hacen falta ronda, contacto y aceptaciones' USING ERRCODE = 'check_violation';
  END IF;
  CASE NEW.estado
    WHEN 'enviada' THEN NEW.enviada_en := now();
    WHEN 'pagada' THEN NEW.pagada_en := now();
    WHEN 'pago_abandonado' THEN NEW.abandonada_en := now();
    ELSE NULL;
  END CASE;
  RETURN NEW;
END
$$;
CREATE TRIGGER solicitud_transicion BEFORE INSERT OR UPDATE OF estado ON solicitud_inscripcion
  FOR EACH ROW EXECUTE FUNCTION transicion_solicitud();

-- =========================================================================================
-- pedido: agrupa inscripciones de un pagador. Su estado es calculado.
-- =========================================================================================
CREATE TABLE pedido (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              text NOT NULL UNIQUE,
  temporada_id        uuid NOT NULL REFERENCES temporada (id) ON DELETE RESTRICT,
  pagador_persona_id  uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  origen              text NOT NULL CHECK (origen IN ('web', 'manual')),
  solicitud_id        uuid REFERENCES solicitud_inscripcion (id) ON DELETE RESTRICT,
  codigo_descuento_id uuid REFERENCES codigo_descuento (id) ON DELETE RESTRICT,
  regla_grupo_id      uuid REFERENCES regla_grupo (id) ON DELETE RESTRICT,
  subtotal_cent       integer NOT NULL CHECK (subtotal_cent >= 0),
  descuento_cent      integer NOT NULL DEFAULT 0 CHECK (descuento_cent >= 0),
  total_cent          integer NOT NULL CHECK (total_cent >= 0),
  estado              text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'pagado_parcial', 'pagado', 'cancelado')),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT pedido_total CHECK (total_cent = subtotal_cent - descuento_cent)
);

ALTER TABLE solicitud_inscripcion ADD CONSTRAINT solicitud_pedido_fk
  FOREIGN KEY (pedido_id) REFERENCES pedido (id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION preparar_pedido() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; t text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'abierto' THEN
      RAISE EXCEPTION 'Un pedido nuevo empieza abierto (su estado se calcula)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.codigo IS NULL THEN
      -- Código legible por temporada: T2-P-0001
      PERFORM pg_advisory_xact_lock(hashtext('pedido:' || NEW.temporada_id));
      SELECT codigo INTO t FROM temporada WHERE id = NEW.temporada_id;
      SELECT coalesce(max(substring(codigo FROM '(\d+)$')::int), 0) + 1 INTO n FROM pedido WHERE temporada_id = NEW.temporada_id;
      NEW.codigo := t || '-P-' || lpad(n::text, 4, '0');
    END IF;
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'El estado del pedido se calcula solo; no se pone a mano' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pedido_preparar BEFORE INSERT OR UPDATE ON pedido
  FOR EACH ROW EXECUTE FUNCTION preparar_pedido();

-- =========================================================================================
-- inscripcion: un piloto en una ronda. Es el centro.
-- =========================================================================================
CREATE TABLE inscripcion (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z0-9]+-R[0-9]+-[0-9]{4}$'),   -- T2-R2-0043
  pedido_id         uuid NOT NULL REFERENCES pedido (id) ON DELETE RESTRICT,
  piloto_persona_id uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  ronda_id          uuid NOT NULL REFERENCES ronda (id) ON DELETE RESTRICT,
  producto_id       uuid NOT NULL REFERENCES producto (id) ON DELETE RESTRICT,
  precio_cent       integer NOT NULL CHECK (precio_cent >= 0),
  categoria_id      uuid REFERENCES categoria (id) ON DELETE RESTRICT,
  categoria_origen  text NOT NULL DEFAULT 'pendiente' CHECK (categoria_origen IN ('por_peso', 'eleccion_franja', 'pendiente')),
  estado            text NOT NULL DEFAULT 'pendiente_pago'
                      CHECK (estado IN ('pendiente_pago', 'reservada', 'pagada', 'trasladada', 'cancelada', 'asistio', 'no_presentado')),
  resolucion        text CHECK (resolucion IN ('pendiente', 'reembolso', 'credito', 'traslado', 'sin_devolucion')),
  sobrecupo         boolean NOT NULL DEFAULT false,
  motivo            text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT inscripcion_resolucion CHECK ((estado = 'cancelada') = (resolucion IS NOT NULL)),
  CONSTRAINT inscripcion_categoria_origen CHECK ((categoria_id IS NULL) = (categoria_origen = 'pendiente'))
);

-- Una inscripción activa por piloto, ronda y categoría; y una sola por piloto y ronda mientras la categoría es nula.
-- Cuántas categorías puede usar un piloto de la franja 80,1–84,9 kg es configuración (temporada.franja_ambas_categorias).
CREATE UNIQUE INDEX inscripcion_activa_categoria ON inscripcion (piloto_persona_id, ronda_id, categoria_id)
  WHERE estado NOT IN ('trasladada', 'cancelada') AND categoria_id IS NOT NULL;
CREATE UNIQUE INDEX inscripcion_activa_sin_categoria ON inscripcion (piloto_persona_id, ronda_id)
  WHERE estado NOT IN ('trasladada', 'cancelada') AND categoria_id IS NULL;

-- Las funciones de saldo (inscripcion_pagado_cent, inscripcion_credito_cent, inscripcion_saldo_cent,
-- inscripcion_comprometido_cent) se definen más abajo, después de pago, aplicacion_pago y movimiento_credito.

-- Recalcula pendiente_pago · reservada · pagada a partir del saldo. No toca los estados finales.
CREATE OR REPLACE FUNCTION recalcular_inscripcion(p_inscripcion uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  i inscripcion;
  cubierto integer;
  nuevo text;
BEGIN
  SELECT * INTO i FROM inscripcion WHERE id = p_inscripcion FOR UPDATE;
  IF NOT FOUND OR i.estado NOT IN ('pendiente_pago', 'reservada', 'pagada') THEN RETURN; END IF;
  cubierto := inscripcion_pagado_cent(i.id) + inscripcion_credito_cent(i.id);
  nuevo := CASE WHEN cubierto >= i.precio_cent THEN 'pagada'
                WHEN cubierto > 0 THEN 'reservada'
                ELSE 'pendiente_pago' END;
  IF nuevo <> i.estado THEN
    UPDATE inscripcion SET estado = nuevo WHERE id = i.id;
  END IF;
END
$$;

-- Recalcula el estado del pedido: cancelado si no le queda ninguna inscripción activa; pagado si todas las
-- activas tienen saldo 0; pagado_parcial si alguna tiene algo cubierto; abierto si no.
CREATE OR REPLACE FUNCTION recalcular_pedido(p_pedido uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actual text;
  activas integer;
  saldadas integer;
  con_algo integer;
  nuevo text;
BEGIN
  SELECT estado INTO actual FROM pedido WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*),
         count(*) FILTER (WHERE inscripcion_saldo_cent(id) <= 0),
         count(*) FILTER (WHERE inscripcion_pagado_cent(id) + inscripcion_credito_cent(id) > 0)
    INTO activas, saldadas, con_algo
  FROM inscripcion WHERE pedido_id = p_pedido AND estado NOT IN ('cancelada', 'trasladada');
  nuevo := CASE
    WHEN activas = 0 AND EXISTS (SELECT 1 FROM inscripcion WHERE pedido_id = p_pedido) THEN 'cancelado'
    WHEN activas = 0 THEN 'abierto'
    WHEN saldadas = activas THEN 'pagado'
    WHEN con_algo > 0 THEN 'pagado_parcial'
    ELSE 'abierto' END;
  IF nuevo <> actual THEN
    UPDATE pedido SET estado = nuevo WHERE id = p_pedido;
  END IF;
END
$$;

-- Antes de guardar una inscripción: código legible, misma temporada en ronda, categoría y producto,
-- sobrecupo y que el precio no baje de lo ya cubierto.
CREATE OR REPLACE FUNCTION preparar_inscripcion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t_ronda uuid; t_codigo text; num smallint; n integer; plazas_cat smallint;
BEGIN
  SELECT r.temporada_id, t.codigo, r.numero INTO t_ronda, t_codigo, num
  FROM ronda r JOIN temporada t ON t.id = r.temporada_id WHERE r.id = NEW.ronda_id;

  IF (SELECT temporada_id FROM producto WHERE id = NEW.producto_id) IS DISTINCT FROM t_ronda
     OR (NEW.categoria_id IS NOT NULL AND (SELECT temporada_id FROM categoria WHERE id = NEW.categoria_id) IS DISTINCT FROM t_ronda)
     OR (SELECT temporada_id FROM pedido WHERE id = NEW.pedido_id) IS DISTINCT FROM t_ronda THEN
    RAISE EXCEPTION 'Ronda, categoría, producto y pedido de la inscripción deben ser de la misma temporada' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.codigo IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('inscripcion:' || NEW.ronda_id));
      SELECT coalesce(max(substring(codigo FROM '(\d{4})$')::int), 0) + 1 INTO n FROM inscripcion WHERE ronda_id = NEW.ronda_id;
      NEW.codigo := t_codigo || '-R' || num || '-' || lpad(n::text, 4, '0');
    END IF;
    -- Sobrecupo: se marca si al crearse la categoría ya estaba llena.
    IF NEW.categoria_id IS NOT NULL THEN
      SELECT plazas INTO plazas_cat FROM cupo_ronda WHERE ronda_id = NEW.ronda_id AND categoria_id = NEW.categoria_id;
      IF plazas_cat IS NOT NULL AND (SELECT count(*) FROM inscripcion
            WHERE ronda_id = NEW.ronda_id AND categoria_id = NEW.categoria_id
              AND estado NOT IN ('trasladada', 'cancelada')) >= plazas_cat THEN
        NEW.sobrecupo := true;
      END IF;
    END IF;
  ELSIF NEW.precio_cent < OLD.precio_cent AND NEW.precio_cent < inscripcion_comprometido_cent(NEW.id) THEN
    RAISE EXCEPTION 'El precio no puede bajar de lo ya aplicado y canjeado en la inscripción' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER inscripcion_preparar BEFORE INSERT OR UPDATE OF ronda_id, categoria_id, producto_id, pedido_id, precio_cent ON inscripcion
  FOR EACH ROW EXECUTE FUNCTION preparar_inscripcion();

-- Transiciones de inscripcion (ver "Estados y transiciones"):
-- - Nueva: pendiente_pago. Los tres estados de cobro se recalculan solos (solo desde un trigger).
-- - pendiente_pago · reservada · pagada → trasladada (hace falta la fila de traslado) o cancelada (motivo obligatorio,
--   resolución pendiente).
-- - reservada · pagada → asistio (onboarding completado o motivo de excepción) o no_presentado.
-- - En cancelada solo avanza la resolución: pendiente → reembolso · credito · traslado · sin_devolucion.
CREATE OR REPLACE FUNCTION transicion_inscripcion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cobro constant text[] := ARRAY['pendiente_pago', 'reservada', 'pagada'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'pendiente_pago' THEN
      RAISE EXCEPTION 'Una inscripción nueva empieza en pendiente_pago; los pagos la hacen avanzar solos' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado = OLD.estado THEN
    IF NEW.resolucion IS DISTINCT FROM OLD.resolucion
       AND NOT (OLD.estado = 'cancelada' AND OLD.resolucion = 'pendiente'
                AND NEW.resolucion IN ('reembolso', 'credito', 'traslado', 'sin_devolucion')) THEN
      RAISE EXCEPTION 'Resolución no permitida: % → %', OLD.resolucion, NEW.resolucion USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.estado = ANY (cobro) AND NEW.estado = ANY (cobro) THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'pendiente_pago, reservada y pagada se calculan a partir de los pagos; no se ponen a mano'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM exigir_transicion('inscripcion', OLD.estado, NEW.estado, ARRAY[
    'pendiente_pago>trasladada', 'reservada>trasladada', 'pagada>trasladada',
    'pendiente_pago>cancelada', 'reservada>cancelada', 'pagada>cancelada',
    'reservada>asistio', 'pagada>asistio',
    'reservada>no_presentado', 'pagada>no_presentado']);

  IF NEW.estado = 'cancelada' THEN
    IF NEW.motivo IS NULL OR btrim(NEW.motivo) = '' THEN
      RAISE EXCEPTION 'Cancelar una inscripción exige motivo' USING ERRCODE = 'check_violation';
    END IF;
    NEW.resolucion := 'pendiente';
  ELSIF NEW.estado = 'trasladada' THEN
    IF NOT EXISTS (SELECT 1 FROM traslado WHERE inscripcion_origen_id = NEW.id) THEN
      RAISE EXCEPTION 'Antes de marcar la inscripción como trasladada, registra el traslado' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.estado = 'asistio' THEN
    IF (NEW.motivo IS NULL OR btrim(NEW.motivo) = '') AND NOT EXISTS (
         SELECT 1 FROM onboarding o JOIN ronda r ON r.temporada_id = o.temporada_id
         WHERE r.id = NEW.ronda_id AND o.persona_id = NEW.piloto_persona_id AND o.estado = 'completado') THEN
      RAISE EXCEPTION 'El piloto no ha completado el onboarding: indica el motivo de la excepción' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER inscripcion_transicion BEFORE INSERT OR UPDATE OF estado, resolucion ON inscripcion
  FOR EACH ROW EXECUTE FUNCTION transicion_inscripcion();

CREATE OR REPLACE FUNCTION tras_cambio_inscripcion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.precio_cent IS DISTINCT FROM OLD.precio_cent THEN
    PERFORM recalcular_inscripcion(NEW.id);
  END IF;
  PERFORM recalcular_pedido(NEW.pedido_id);
  IF TG_OP = 'UPDATE' AND NEW.pedido_id IS DISTINCT FROM OLD.pedido_id THEN
    PERFORM recalcular_pedido(OLD.pedido_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER inscripcion_recalcular AFTER INSERT OR UPDATE OF estado, precio_cent, pedido_id ON inscripcion
  FOR EACH ROW EXECUTE FUNCTION tras_cambio_inscripcion();

-- Cancelar una ronda cancela sus inscripciones activas (resolución pendiente).
CREATE OR REPLACE FUNCTION cancelar_inscripciones_de_ronda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE inscripcion SET estado = 'cancelada', motivo = coalesce(motivo, 'Ronda cancelada')
  WHERE ronda_id = NEW.id AND estado IN ('pendiente_pago', 'reservada', 'pagada');
  RETURN NULL;
END
$$;
CREATE TRIGGER ronda_cancelar_inscripciones AFTER UPDATE OF estado ON ronda
  FOR EACH ROW WHEN (NEW.estado = 'cancelada' AND OLD.estado <> 'cancelada')
  EXECUTE FUNCTION cancelar_inscripciones_de_ronda();

-- =========================================================================================
-- pago
-- =========================================================================================
CREATE SEQUENCE pago_codigo_seq;

CREATE TABLE pago (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                     text NOT NULL UNIQUE DEFAULT ('PG-' || lpad(nextval('pago_codigo_seq')::text, 5, '0')),
  pagador_persona_id         uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  entidad_cobradora_id       uuid NOT NULL REFERENCES entidad_cobradora (id) ON DELETE RESTRICT,
  metodo                     text NOT NULL CHECK (metodo IN ('stripe_tarjeta', 'stripe_bizum', 'stripe_otro', 'bizum_manual', 'transferencia', 'efectivo')),
  importe_cent               integer NOT NULL CHECK (importe_cent > 0),
  estado                     text NOT NULL CHECK (estado IN ('pendiente_verificacion', 'confirmado', 'fallido', 'reembolsado_parcial', 'reembolsado')),
  recibido_en                timestamptz,
  confirmado_en              timestamptz,
  confirmado_por             text CHECK (confirmado_por = 'stripe' OR confirmado_por ~ '^admin:[0-9a-f-]{36}$'),
  stripe_payment_intent_id   text UNIQUE,
  stripe_checkout_session_id text,
  referencia_externa         text,   -- concepto del Bizum o de la transferencia
  justificante_path          text,   -- almacén privado
  cobrado_por                text,   -- en efectivo: quién lo recibió
  ronda_id                   uuid REFERENCES ronda (id) ON DELETE RESTRICT,   -- si se cobró en el circuito
  factura_ref                text,   -- número de la factura emitida en el software externo
  creado_en                  timestamptz NOT NULL DEFAULT now(),
  actualizado_en             timestamptz NOT NULL DEFAULT now(),
  creado_por                 text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por))
);

-- Transiciones de pago: nuevo → confirmado · pendiente_verificacion · fallido;
-- pendiente_verificacion → confirmado · fallido; confirmado → reembolsado_parcial · reembolsado
-- (y reembolsado_parcial → reembolsado con un segundo reembolso). Los reembolsados solo los pone el trigger de reembolso.
CREATE OR REPLACE FUNCTION transicion_pago() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  PERFORM exigir_transicion('pago', CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END, NEW.estado, ARRAY[
    '(nuevo)>confirmado', '(nuevo)>pendiente_verificacion', '(nuevo)>fallido',
    'pendiente_verificacion>confirmado', 'pendiente_verificacion>fallido',
    'confirmado>reembolsado_parcial', 'confirmado>reembolsado', 'reembolsado_parcial>reembolsado']);
  IF NEW.estado IN ('reembolsado_parcial', 'reembolsado') AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'El estado reembolsado lo pone el registro del reembolso, no se pone a mano' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.estado = 'confirmado' THEN
    NEW.confirmado_en := coalesce(NEW.confirmado_en, now());
    NEW.recibido_en := coalesce(NEW.recibido_en, NEW.confirmado_en);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pago_transicion BEFORE INSERT OR UPDATE OF estado ON pago
  FOR EACH ROW EXECUTE FUNCTION transicion_pago();

-- =========================================================================================
-- aplicacion_pago: reparto de cada pago entre inscripciones
-- =========================================================================================
CREATE TABLE aplicacion_pago (
  pago_id        uuid NOT NULL REFERENCES pago (id) ON DELETE RESTRICT,
  inscripcion_id uuid NOT NULL REFERENCES inscripcion (id) ON DELETE RESTRICT,
  importe_cent   integer NOT NULL CHECK (importe_cent > 0),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  PRIMARY KEY (pago_id, inscripcion_id)
);

-- Lo aplicado de un pago no supera su importe menos lo reembolsado; lo comprometido en una inscripción no supera su precio.
CREATE OR REPLACE FUNCTION comprobar_aplicacion_pago() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p pago;
  reembolsado integer;
  aplicado_pago integer;
  precio integer;
  comprometido integer;
  viejo_pago uuid;
  vieja_insc uuid;
  viejo_importe integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    viejo_pago := OLD.pago_id; vieja_insc := OLD.inscripcion_id; viejo_importe := OLD.importe_cent;
  END IF;

  SELECT * INTO p FROM pago WHERE id = NEW.pago_id FOR UPDATE;
  SELECT coalesce(sum(importe_cent), 0) INTO reembolsado FROM reembolso WHERE pago_id = NEW.pago_id AND estado = 'emitido';
  SELECT coalesce(sum(importe_cent), 0) INTO aplicado_pago FROM aplicacion_pago
  WHERE pago_id = NEW.pago_id AND (pago_id, inscripcion_id) IS DISTINCT FROM (viejo_pago, vieja_insc);
  IF aplicado_pago + NEW.importe_cent > p.importe_cent - reembolsado THEN
    RAISE EXCEPTION 'Lo aplicado del pago % (% + % céntimos) supera su importe menos lo reembolsado (% céntimos)',
      p.codigo, aplicado_pago, NEW.importe_cent, p.importe_cent - reembolsado USING ERRCODE = 'check_violation';
  END IF;

  SELECT precio_cent INTO precio FROM inscripcion WHERE id = NEW.inscripcion_id FOR UPDATE;
  comprometido := inscripcion_comprometido_cent(NEW.inscripcion_id);
  IF vieja_insc = NEW.inscripcion_id AND p.estado <> 'fallido' THEN
    comprometido := comprometido - viejo_importe;
  END IF;
  IF p.estado <> 'fallido' AND comprometido + NEW.importe_cent > precio THEN
    RAISE EXCEPTION 'Lo aplicado a la inscripción (% + % céntimos) supera su precio (% céntimos)',
      comprometido, NEW.importe_cent, precio USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aplicacion_pago_comprobar BEFORE INSERT OR UPDATE ON aplicacion_pago
  FOR EACH ROW EXECUTE FUNCTION comprobar_aplicacion_pago();

CREATE OR REPLACE FUNCTION tras_cambio_aplicacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM recalcular_inscripcion(OLD.inscripcion_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.inscripcion_id IS DISTINCT FROM OLD.inscripcion_id
                            OR NEW.importe_cent IS DISTINCT FROM OLD.importe_cent) THEN
    PERFORM recalcular_inscripcion(NEW.inscripcion_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER aplicacion_pago_recalcular AFTER INSERT OR UPDATE OR DELETE ON aplicacion_pago
  FOR EACH ROW EXECUTE FUNCTION tras_cambio_aplicacion();

-- Cuando cambia el estado de un pago, se recalculan las inscripciones a las que está aplicado.
CREATE OR REPLACE FUNCTION tras_cambio_estado_pago() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT inscripcion_id FROM aplicacion_pago WHERE pago_id = NEW.id LOOP
    PERFORM recalcular_inscripcion(r.inscripcion_id);
  END LOOP;
  RETURN NULL;
END
$$;
CREATE TRIGGER pago_recalcular AFTER UPDATE OF estado ON pago
  FOR EACH ROW WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
  EXECUTE FUNCTION tras_cambio_estado_pago();

-- =========================================================================================
-- movimiento_credito (libro de créditos): + abono, − canje. El saldo nunca baja de cero.
-- =========================================================================================
CREATE TABLE movimiento_credito (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid NOT NULL REFERENCES persona (id) ON DELETE RESTRICT,
  importe_cent   integer NOT NULL CHECK (importe_cent <> 0),
  tipo           text NOT NULL CHECK (tipo IN ('fidelidad', 'compensacion_cancelacion', 'canje', 'caducidad', 'ajuste')),
  inscripcion_id uuid REFERENCES inscripcion (id) ON DELETE RESTRICT,
  caduca_en      timestamptz,
  motivo         text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT credito_signo CHECK (
    (tipo IN ('fidelidad', 'compensacion_cancelacion') AND importe_cent > 0)
    OR (tipo IN ('canje', 'caducidad') AND importe_cent < 0)
    OR tipo = 'ajuste'),
  CONSTRAINT credito_canje_inscripcion CHECK (tipo <> 'canje' OR inscripcion_id IS NOT NULL),
  CONSTRAINT credito_motivo_ajuste CHECK (tipo <> 'ajuste' OR (motivo IS NOT NULL AND btrim(motivo) <> ''))
);

CREATE OR REPLACE FUNCTION credito_saldo_cent(p_persona uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(importe_cent), 0)::int FROM movimiento_credito WHERE persona_id = p_persona
$$;

-- Lo pagado de una inscripción con pagos que cuentan (confirmados o reembolsados en parte).
CREATE OR REPLACE FUNCTION inscripcion_pagado_cent(p_inscripcion uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(a.importe_cent), 0)::int
  FROM aplicacion_pago a JOIN pago p ON p.id = a.pago_id
  WHERE a.inscripcion_id = p_inscripcion AND p.estado IN ('confirmado', 'reembolsado_parcial', 'reembolsado')
$$;
-- Lo canjeado de crédito en una inscripción (en positivo).
CREATE OR REPLACE FUNCTION inscripcion_credito_cent(p_inscripcion uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce(-sum(importe_cent), 0)::int FROM movimiento_credito
  WHERE inscripcion_id = p_inscripcion AND tipo = 'canje'
$$;
-- Saldo pendiente: precio − pagos aplicados − créditos canjeados. No se guarda: se calcula.
CREATE OR REPLACE FUNCTION inscripcion_saldo_cent(p_inscripcion uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT i.precio_cent - inscripcion_pagado_cent(i.id) - inscripcion_credito_cent(i.id)
  FROM inscripcion i WHERE i.id = p_inscripcion
$$;
-- Lo comprometido en una inscripción para el límite de su precio: aplicaciones de pagos no fallidos
-- (también los pendientes de verificar, para no comprometer dos veces) más los canjes de crédito.
CREATE OR REPLACE FUNCTION inscripcion_comprometido_cent(p_inscripcion uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT sum(a.importe_cent) FROM aplicacion_pago a JOIN pago p ON p.id = a.pago_id
                   WHERE a.inscripcion_id = p_inscripcion AND p.estado <> 'fallido'), 0)::int
       + inscripcion_credito_cent(p_inscripcion)
$$;

-- Un canje no puede pasar del precio de la inscripción.
CREATE OR REPLACE FUNCTION comprobar_movimiento_credito() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  precio integer;
  comprometido integer;
BEGIN
  IF NEW.tipo = 'canje' THEN
    SELECT precio_cent INTO precio FROM inscripcion WHERE id = NEW.inscripcion_id FOR UPDATE;
    comprometido := inscripcion_comprometido_cent(NEW.inscripcion_id);
    IF TG_OP = 'UPDATE' AND OLD.tipo = 'canje' AND OLD.inscripcion_id = NEW.inscripcion_id THEN
      comprometido := comprometido + OLD.importe_cent;   -- OLD.importe_cent es negativo
    END IF;
    IF comprometido - NEW.importe_cent > precio THEN
      RAISE EXCEPTION 'El canje (% céntimos) supera lo que queda por pagar de la inscripción', -NEW.importe_cent
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER movimiento_credito_comprobar BEFORE INSERT OR UPDATE ON movimiento_credito
  FOR EACH ROW EXECUTE FUNCTION comprobar_movimiento_credito();

CREATE OR REPLACE FUNCTION tras_movimiento_credito() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pers uuid;
BEGIN
  FOR pers IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.persona_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.persona_id END]) AS x WHERE x IS NOT NULL LOOP
    PERFORM pg_advisory_xact_lock(hashtext('credito:' || pers));
    IF credito_saldo_cent(pers) < 0 THEN
      RAISE EXCEPTION 'El saldo de créditos no puede quedar por debajo de cero (quedaría en % céntimos)', credito_saldo_cent(pers)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP <> 'INSERT' AND OLD.inscripcion_id IS NOT NULL THEN PERFORM recalcular_inscripcion(OLD.inscripcion_id); END IF;
  IF TG_OP <> 'DELETE' AND NEW.inscripcion_id IS NOT NULL THEN PERFORM recalcular_inscripcion(NEW.inscripcion_id); END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER movimiento_credito_saldo AFTER INSERT OR UPDATE OR DELETE ON movimiento_credito
  FOR EACH ROW EXECUTE FUNCTION tras_movimiento_credito();

-- =========================================================================================
-- reembolso
-- =========================================================================================
CREATE TABLE reembolso (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id          uuid NOT NULL REFERENCES pago (id) ON DELETE RESTRICT,
  importe_cent     integer NOT NULL CHECK (importe_cent > 0),
  estado           text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'emitido', 'fallido')),
  stripe_refund_id text UNIQUE,
  emitido_en       timestamptz,
  motivo           text NOT NULL,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT reembolso_emitido_en CHECK ((estado = 'emitido') = (emitido_en IS NOT NULL))
);

-- Un reembolso emitido no se toca. Al emitirse: no supera lo cobrado y, antes, hay que reducir lo aplicado del
-- pago para que siga cumpliéndose "aplicado ≤ importe − reembolsado".
CREATE OR REPLACE FUNCTION comprobar_reembolso() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p pago;
  emitidos integer;
  aplicado integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.estado IN ('emitido', 'fallido')
     AND (NEW.estado, NEW.importe_cent, NEW.pago_id) IS DISTINCT FROM (OLD.estado, OLD.importe_cent, OLD.pago_id) THEN
    RAISE EXCEPTION 'Un reembolso % ya no se modifica', OLD.estado USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.estado = 'emitido' AND (TG_OP = 'INSERT' OR OLD.estado <> 'emitido') THEN
    NEW.emitido_en := coalesce(NEW.emitido_en, now());
    SELECT * INTO p FROM pago WHERE id = NEW.pago_id FOR UPDATE;
    IF p.estado NOT IN ('confirmado', 'reembolsado_parcial') THEN
      RAISE EXCEPTION 'Solo se reembolsan pagos confirmados (el pago % está %)', p.codigo, p.estado USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(importe_cent), 0) INTO emitidos FROM reembolso
    WHERE pago_id = NEW.pago_id AND estado = 'emitido' AND id <> NEW.id;
    IF emitidos + NEW.importe_cent > p.importe_cent THEN
      RAISE EXCEPTION 'Lo reembolsado (% céntimos) superaría el importe del pago (% céntimos)', emitidos + NEW.importe_cent, p.importe_cent
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(importe_cent), 0) INTO aplicado FROM aplicacion_pago WHERE pago_id = NEW.pago_id;
    IF aplicado > p.importe_cent - emitidos - NEW.importe_cent THEN
      RAISE EXCEPTION 'Antes de reembolsar, reduce lo aplicado del pago a inscripciones (aplicado: % céntimos; tras el reembolso quedarían %)',
        aplicado, p.importe_cent - emitidos - NEW.importe_cent USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reembolso_comprobar BEFORE INSERT OR UPDATE ON reembolso
  FOR EACH ROW EXECUTE FUNCTION comprobar_reembolso();

-- Al emitirse un reembolso, el pago pasa a reembolsado_parcial o reembolsado.
CREATE OR REPLACE FUNCTION tras_reembolso() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total integer;
  importe integer;
BEGIN
  IF NEW.estado = 'emitido' AND (TG_OP = 'INSERT' OR OLD.estado <> 'emitido') THEN
    SELECT importe_cent INTO importe FROM pago WHERE id = NEW.pago_id;
    SELECT coalesce(sum(importe_cent), 0) INTO total FROM reembolso WHERE pago_id = NEW.pago_id AND estado = 'emitido';
    UPDATE pago SET estado = CASE WHEN total >= importe THEN 'reembolsado' ELSE 'reembolsado_parcial' END
    WHERE id = NEW.pago_id AND estado <> CASE WHEN total >= importe THEN 'reembolsado' ELSE 'reembolsado_parcial' END;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER reembolso_pago AFTER INSERT OR UPDATE OF estado ON reembolso
  FOR EACH ROW EXECUTE FUNCTION tras_reembolso();

-- =========================================================================================
-- traslado
-- =========================================================================================
CREATE TABLE traslado (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_origen_id  uuid NOT NULL UNIQUE REFERENCES inscripcion (id) ON DELETE RESTRICT,
  inscripcion_destino_id uuid NOT NULL UNIQUE REFERENCES inscripcion (id) ON DELETE RESTRICT,
  solicitado_en          timestamptz NOT NULL DEFAULT now(),   -- cuándo avisó el piloto
  dias_antelacion        integer NOT NULL,                     -- fecha de la ronda origen − aviso
  fuera_de_plazo         boolean NOT NULL,                     -- menos días que dias_aviso_traslado
  motivo_excepcion       text,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  actualizado_en         timestamptz NOT NULL DEFAULT now(),
  creado_por             text NOT NULL DEFAULT 'sistema' CHECK (creado_por_valido(creado_por)),
  CONSTRAINT traslado_distintas CHECK (inscripcion_origen_id <> inscripcion_destino_id),
  CONSTRAINT traslado_motivo CHECK (NOT fuera_de_plazo OR (motivo_excepcion IS NOT NULL AND btrim(motivo_excepcion) <> ''))
);

-- Calcula días de antelación y si está fuera de plazo; origen y destino son del mismo piloto.
CREATE OR REPLACE FUNCTION preparar_traslado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fecha_origen date;
  aviso smallint;
BEGIN
  SELECT r.fecha, t.dias_aviso_traslado INTO fecha_origen, aviso
  FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id JOIN temporada t ON t.id = r.temporada_id
  WHERE i.id = NEW.inscripcion_origen_id;
  IF (SELECT piloto_persona_id FROM inscripcion WHERE id = NEW.inscripcion_origen_id)
     IS DISTINCT FROM (SELECT piloto_persona_id FROM inscripcion WHERE id = NEW.inscripcion_destino_id) THEN
    RAISE EXCEPTION 'Un traslado mueve la inscripción del mismo piloto a otra ronda' USING ERRCODE = 'check_violation';
  END IF;
  NEW.dias_antelacion := fecha_origen - (NEW.solicitado_en AT TIME ZONE 'Europe/Madrid')::date;
  NEW.fuera_de_plazo := NEW.dias_antelacion < aviso;
  RETURN NEW;
END
$$;
CREATE TRIGGER traslado_preparar BEFORE INSERT OR UPDATE ON traslado
  FOR EACH ROW EXECUTE FUNCTION preparar_traslado();

-- =========================================================================================
-- stripe_evento: un evento de Stripe se procesa una sola vez
-- =========================================================================================
CREATE TABLE stripe_evento (
  stripe_event_id text PRIMARY KEY,
  tipo            text NOT NULL,
  recibido_en     timestamptz NOT NULL DEFAULT now(),
  procesado_en    timestamptz,
  error           text
);

-- =========================================================================================
-- Índices (FK y búsquedas). solicitud.codigo, pago.stripe_payment_intent_id y los token_hash tienen índice por su UNIQUE.
-- =========================================================================================
CREATE INDEX solicitud_temporada_idx     ON solicitud_inscripcion (temporada_id);
CREATE INDEX solicitud_ronda_idx         ON solicitud_inscripcion (ronda_id);
CREATE INDEX solicitud_persona_idx       ON solicitud_inscripcion (persona_id);
CREATE INDEX solicitud_pedido_idx        ON solicitud_inscripcion (pedido_id);
CREATE INDEX solicitud_estado_idx        ON solicitud_inscripcion (estado, ultimo_guardado_en);
CREATE INDEX solicitud_telefono_idx      ON solicitud_inscripcion (pagador_telefono);
CREATE INDEX solicitud_email_idx         ON solicitud_inscripcion (lower(pagador_email));
CREATE INDEX pedido_temporada_idx        ON pedido (temporada_id);
CREATE INDEX pedido_pagador_idx          ON pedido (pagador_persona_id);
CREATE INDEX pedido_solicitud_idx        ON pedido (solicitud_id);
CREATE INDEX pedido_codigo_desc_idx      ON pedido (codigo_descuento_id);
CREATE INDEX pedido_regla_grupo_idx      ON pedido (regla_grupo_id);
CREATE INDEX inscripcion_pedido_idx      ON inscripcion (pedido_id);
CREATE INDEX inscripcion_piloto_idx      ON inscripcion (piloto_persona_id);
CREATE INDEX inscripcion_ronda_idx       ON inscripcion (ronda_id, categoria_id, estado);
CREATE INDEX inscripcion_producto_idx    ON inscripcion (producto_id);
CREATE INDEX inscripcion_categoria_idx   ON inscripcion (categoria_id);
CREATE INDEX pago_pagador_idx            ON pago (pagador_persona_id);
CREATE INDEX pago_entidad_idx            ON pago (entidad_cobradora_id);
CREATE INDEX pago_ronda_idx              ON pago (ronda_id);
CREATE INDEX pago_estado_idx             ON pago (estado);
CREATE INDEX pago_referencia_idx         ON pago (referencia_externa);
CREATE INDEX pago_checkout_idx           ON pago (stripe_checkout_session_id);
CREATE INDEX aplicacion_inscripcion_idx  ON aplicacion_pago (inscripcion_id);
CREATE INDEX credito_persona_idx         ON movimiento_credito (persona_id);
CREATE INDEX credito_inscripcion_idx     ON movimiento_credito (inscripcion_id);
CREATE INDEX reembolso_pago_idx          ON reembolso (pago_id);

-- =========================================================================================
-- actualizado_en e historial
-- =========================================================================================
CREATE TRIGGER entidad_cobradora_actualizado_en  BEFORE UPDATE ON entidad_cobradora     FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER solicitud_actualizado_en          BEFORE UPDATE ON solicitud_inscripcion FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER pedido_actualizado_en             BEFORE UPDATE ON pedido                FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER inscripcion_actualizado_en        BEFORE UPDATE ON inscripcion           FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER pago_actualizado_en               BEFORE UPDATE ON pago                  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER aplicacion_pago_actualizado_en    BEFORE UPDATE ON aplicacion_pago       FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER movimiento_credito_actualizado_en BEFORE UPDATE ON movimiento_credito    FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER reembolso_actualizado_en          BEFORE UPDATE ON reembolso             FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER traslado_actualizado_en           BEFORE UPDATE ON traslado              FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

CREATE TRIGGER entidad_cobradora_evento  AFTER INSERT OR UPDATE ON entidad_cobradora           FOR EACH ROW EXECUTE FUNCTION registrar_evento('activa_desde,activa_hasta');
CREATE TRIGGER solicitud_evento          AFTER INSERT OR UPDATE ON solicitud_inscripcion       FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,acepta_comunicaciones,consentimiento_medicion');
CREATE TRIGGER pedido_evento             AFTER INSERT OR UPDATE ON pedido                      FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,subtotal_cent,descuento_cent,total_cent');
CREATE TRIGGER inscripcion_evento        AFTER INSERT OR UPDATE ON inscripcion                 FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,resolucion,precio_cent,ronda_id,categoria_id');
CREATE TRIGGER pago_evento               AFTER INSERT OR UPDATE ON pago                        FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,importe_cent,metodo');
CREATE TRIGGER aplicacion_pago_evento    AFTER INSERT OR UPDATE OR DELETE ON aplicacion_pago   FOR EACH ROW EXECUTE FUNCTION registrar_evento('importe_cent', 'pago_id,inscripcion_id');
CREATE TRIGGER movimiento_credito_evento AFTER INSERT OR UPDATE OR DELETE ON movimiento_credito FOR EACH ROW EXECUTE FUNCTION registrar_evento('tipo,importe_cent,inscripcion_id');
CREATE TRIGGER reembolso_evento          AFTER INSERT OR UPDATE ON reembolso                   FOR EACH ROW EXECUTE FUNCTION registrar_evento('estado,importe_cent');
CREATE TRIGGER traslado_evento           AFTER INSERT OR UPDATE ON traslado                    FOR EACH ROW EXECUTE FUNCTION registrar_evento('inscripcion_origen_id,inscripcion_destino_id,fuera_de_plazo');
