-- 0011 · Bot de WhatsApp: marca de respuestas a mensajes que no tienen que ver con RUKC ni con el karting.
-- Con 3 de las últimas 4 respuestas del bot marcadas, la conversación se corta, pasa a John y el bot deja de gastar
-- tokens en ella. Solo añade una columna con valor por defecto a una tabla del bot (0010).
ALTER TABLE wa_messages ADD COLUMN fuera_de_tema boolean NOT NULL DEFAULT false;
