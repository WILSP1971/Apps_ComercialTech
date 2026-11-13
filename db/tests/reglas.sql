-- db/tests/reglas.sql
BEGIN;
-- Datos mínimos
INSERT INTO inventarios.bodega (id, empresa_id, codigo, nombre)
  VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'B1', 'Principal');

-- Utilidad: afirma que una sentencia falla con el SQLSTATE esperado
CREATE OR REPLACE FUNCTION pg_temp.espera_error(p_sql text, p_estado text, p_regla text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado THEN RETURN; END IF;
    RAISE EXCEPTION '% falló con SQLSTATE % (se esperaba %): %', p_regla, SQLSTATE, p_estado, SQLERRM;
  END;
  RAISE EXCEPTION '% NO se aplicó: la sentencia debía fallar', p_regla;
END; $$ LANGUAGE plpgsql;

-- R3 / R5: no se puede reservar ni sacar más de lo que hay (el kardex alimenta la existencia)
SELECT pg_temp.espera_error($q$
  INSERT INTO inventarios.kardex (empresa_id, articulo_id, bodega_id, tipo, delta_reservado)
  VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000b1','RESERVA', 5)$q$, '23514', 'R3');

-- R5: el kardex es inmutable
INSERT INTO inventarios.kardex (id, empresa_id, articulo_id, bodega_id, tipo, delta_fisico)
VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','AJUSTE_POSITIVO', 10);
SELECT pg_temp.espera_error($q$DELETE FROM inventarios.kardex$q$, 'P0001', 'R5');
SELECT 1 / (CASE WHEN count(*) = 0 THEN 1 ELSE 0 END) FROM inventarios.v_inconsistencias_kardex;  -- 0 inconsistencias

-- R8: dos sesiones abiertas para la misma caja
INSERT INTO caja.caja (id, empresa_id, codigo, nombre)
  VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1','C1','Caja 1');
INSERT INTO caja.sesion_caja (id, empresa_id, caja_id, usuario_id)
  VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1', gen_random_uuid());
SELECT pg_temp.espera_error($q$
  INSERT INTO caja.sesion_caja (id, empresa_id, caja_id, usuario_id)
  VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1', gen_random_uuid())$q$,
  '23505', 'R8');

-- R10: no se acepta un número de tarjeta como referencia
SELECT pg_temp.espera_error($q$
  INSERT INTO caja.movimiento_caja (id, empresa_id, sesion_id, tipo, sentido, medio_pago, valor, referencia, idempotency_key, usuario_id)
  SELECT gen_random_uuid(), empresa_id, id, 'COBRO', 'ENTRADA', 'TARJETA', 1000, '4111 1111 1111 1111', gen_random_uuid(), usuario_id
    FROM caja.sesion_caja LIMIT 1$q$, '23514', 'R10');

ROLLBACK;
