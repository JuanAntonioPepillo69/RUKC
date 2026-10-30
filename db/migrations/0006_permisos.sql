-- 0006 · Permisos del rol de la aplicación (rukc_app).
-- Diseño: "Seguridad" → acceso a la base de datos. rukc_app lee y escribe negocio; no puede modificar ni borrar
-- el historial (evento) ni las aceptaciones (salvo revocada_en), y no tiene permisos de esquema (no crea ni cambia tablas).
-- Las migraciones las aplica rukc_migraciones, que es el propietario de todo.

GRANT USAGE ON SCHEMA public TO rukc_app;

-- Negocio: leer y escribir. El borrado físico no se usa en tablas de negocio (estados finales o anonimización),
-- pero se mantiene para correcciones de aplicaciones de pago, vistas guardadas, límites y borradores caducados.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rukc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rukc_app;

-- Historial: solo leer y añadir.
REVOKE UPDATE, DELETE, TRUNCATE ON evento FROM rukc_app;

-- Aceptaciones: leer, añadir y fijar revocada_en. Nunca borrar ni editar el resto.
REVOKE UPDATE, DELETE, TRUNCATE ON aceptacion FROM rukc_app;
GRANT UPDATE (revocada_en) ON aceptacion TO rukc_app;

-- Las vistas son de solo lectura.
REVOKE INSERT, UPDATE, DELETE ON v_embudo, v_leads, v_inscripciones, v_parrilla, v_pagos, v_caja,
                                  v_onboarding, v_feedback, v_creditos, v_persona_360 FROM rukc_app;

-- Control de migraciones: no es asunto de la aplicación.
REVOKE ALL ON _migraciones FROM rukc_app;

-- Tablas y secuencias que creen migraciones futuras: mismos permisos de negocio por defecto.
-- (Las excepciones como evento o aceptacion se declaran en la migración que crea cada tabla.)
ALTER DEFAULT PRIVILEGES FOR ROLE rukc_migraciones IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rukc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rukc_migraciones IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rukc_app;
