-- Plaza confirmada sin pago: el equipo da plaza a alguien que todavía no ha pagado nada (pagará en efectivo, por
-- ejemplo). La inscripción sigue en pendiente_pago, porque los estados de cobro salen solo de los pagos, pero el bot la
-- trata como una plaza: recordatorios de la ronda, ficha de piloto, enlace del grupo y avisos a los inscritos.
ALTER TABLE inscripcion ADD COLUMN plaza_confirmada boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN inscripcion.plaza_confirmada IS 'Plaza dada por el equipo sin ningún pago todavía; el bot la trata como reservada.';
