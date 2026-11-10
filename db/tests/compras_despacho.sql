-- db/tests/compras_despacho.sql   (ejecutar tras 110_compras_despacho.sql; todo se revierte al final)
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.espera_error(p_sql text, p_estado text, p_regla text) RETURNS void AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado THEN RETURN; END IF;
    RAISE EXCEPTION '% falló con SQLSTATE % (se esperaba %): %', p_regla, SQLSTATE, p_estado, SQLERRM;
  END;
  RAISE EXCEPTION '% NO se aplicó: la sentencia debía fallar', p_regla;
END; $$ LANGUAGE plpgsql;

-- ---------- R11: una orden con mercadería sin recibir no se puede cerrar ----------
INSERT INTO compras.proveedor (id, empresa_id, nit, razon_social)
  VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1','900123456','Proveedor de prueba');
INSERT INTO compras.orden_compra (id, empresa_id, numero, proveedor_id, bodega_id, estado, creado_por)
  VALUES ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000e1','OC-T1',
          '00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','ENVIADA','00000000-0000-0000-0000-0000000000f1');
INSERT INTO compras.orden_compra_linea (id, empresa_id, orden_id, articulo_id, cantidad, cantidad_recibida, costo_unitario)
  VALUES ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d2',
          '00000000-0000-0000-0000-0000000000a1', 10, 4, 1000);
SELECT pg_temp.espera_error($q$UPDATE compras.orden_compra SET estado='CERRADA' WHERE id='00000000-0000-0000-0000-0000000000d2'$q$, '23514', 'R11');
SELECT pg_temp.espera_error($q$UPDATE compras.orden_compra_linea SET cantidad_recibida = 11 WHERE id='00000000-0000-0000-0000-0000000000d3'$q$, '23514', 'recepción > pedido');
UPDATE compras.orden_compra_linea SET cantidad_recibida = 10 WHERE id='00000000-0000-0000-0000-0000000000d3';
UPDATE compras.orden_compra SET estado='CERRADA' WHERE id='00000000-0000-0000-0000-0000000000d2';      -- ahora sí
SELECT 1 / (CASE WHEN count(*) = 0 THEN 1 ELSE 0 END) FROM compras.v_pendiente_recibir WHERE orden_id='00000000-0000-0000-0000-0000000000d2';

-- ---------- R12: despacho sin reserva consumida no puede pasar a DESPACHADO ----------
INSERT INTO despacho.despacho (id, empresa_id, numero, pedido_id, cliente_id, bodega_id, direccion_entrega)
  VALUES ('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000e1','DES-T1',
          '00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-0000000000d6','00000000-0000-0000-0000-0000000000b1','Calle 1 # 2-3');
SELECT pg_temp.espera_error($q$UPDATE despacho.despacho SET estado='DESPACHADO' WHERE id='00000000-0000-0000-0000-0000000000d4'$q$, '23514', 'R12 sin líneas');

INSERT INTO inventarios.reserva_stock (id, empresa_id, articulo_id, bodega_id, pedido_id, pedido_linea_id, cantidad, estado, clave_idempotencia)
  VALUES ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-0000000000d8', 2, 'ACTIVA', 'test-r12');
INSERT INTO despacho.despacho_linea (id, empresa_id, despacho_id, pedido_linea_id, articulo_id, cantidad, reserva_id)
  VALUES ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d4',
          '00000000-0000-0000-0000-0000000000d8','00000000-0000-0000-0000-0000000000a1', 2, '00000000-0000-0000-0000-0000000000d7');
SELECT pg_temp.espera_error($q$UPDATE despacho.despacho SET estado='DESPACHADO' WHERE id='00000000-0000-0000-0000-0000000000d4'$q$, '23514', 'R12 reserva ACTIVA');
-- una reserva no respalda dos líneas vigentes
SELECT pg_temp.espera_error($q$INSERT INTO despacho.despacho_linea (id, empresa_id, despacho_id, pedido_linea_id, articulo_id, cantidad, reserva_id)
  VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d4',
          '00000000-0000-0000-0000-0000000000d8','00000000-0000-0000-0000-0000000000a1', 2, '00000000-0000-0000-0000-0000000000d7')$q$, '23505', 'reserva única');
UPDATE inventarios.reserva_stock SET estado='CONSUMIDA' WHERE id='00000000-0000-0000-0000-0000000000d7';
UPDATE despacho.despacho SET estado='DESPACHADO' WHERE id='00000000-0000-0000-0000-0000000000d4';       -- con reserva consumida, sí
SELECT pg_temp.espera_error($q$UPDATE despacho.despacho SET estado='EN_CAMINO' WHERE id='00000000-0000-0000-0000-0000000000d4'$q$, '23514', 'estado válido');

ROLLBACK;
