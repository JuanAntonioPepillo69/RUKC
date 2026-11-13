-- 0016 · Consumo de Claude por llamada (fase 4 del bot: métricas mensuales y coste de Claude).
-- Una fila por llamada a la API (turno del bot, canal admin, clasificadores y resúmenes) con sus tokens. No guarda
-- texto ni a quién se respondía: solo cuánto se gastó. Solo añade una tabla del bot; no cambia ni borra nada.
CREATE TABLE wa_llm_usage (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uso              text NOT NULL CHECK (uso IN ('conversacion', 'admin', 'clasificador', 'resumen')),
  modelo           text NOT NULL,
  entrada          integer NOT NULL DEFAULT 0 CHECK (entrada >= 0),
  salida           integer NOT NULL DEFAULT 0 CHECK (salida >= 0),
  cache_lectura    integer NOT NULL DEFAULT 0 CHECK (cache_lectura >= 0),
  cache_escritura  integer NOT NULL DEFAULT 0 CHECK (cache_escritura >= 0),
  busquedas        integer NOT NULL DEFAULT 0 CHECK (busquedas >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_llm_usage_fecha_idx ON wa_llm_usage (created_at);

-- rukc_app solo lee y añade.
GRANT SELECT, INSERT ON wa_llm_usage TO rukc_app;
REVOKE UPDATE, DELETE, TRUNCATE ON wa_llm_usage FROM rukc_app;
