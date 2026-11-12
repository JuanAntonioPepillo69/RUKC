-- 0012 · Bot de WhatsApp: temas escalados a John en cada conversación.
-- Hay escalados en los que el bot sigue contestando el resto de dudas (devoluciones, pagos, descuentos...). Con esta
-- lista el bot sabe qué tiene John pendiente y a John le llega un solo aviso por tema. Solo añade una columna con valor
-- por defecto a una tabla del bot (0010).
ALTER TABLE wa_conversations ADD COLUMN temas_escalados text[] NOT NULL DEFAULT '{}';
