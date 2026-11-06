-- db/scripts/050_facturacion.sql

-- R14: serie de numeración fiscal. El número se toma con bloqueo transaccional.
CREATE TABLE facturacion.serie_documento (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('FACTURA','NOTA_CREDITO')),
  prefijo            text NOT NULL,
  numero_resolucion  text NOT NULL,
  rango_desde        bigint NOT NULL,
  rango_hasta        bigint NOT NULL,
  ultimo_numero      bigint NOT NULL,                      -- inicia en rango_desde - 1
  vigente_hasta      date NOT NULL,
  activa             boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, tipo, prefijo),
  CHECK (ultimo_numero >= rango_desde - 1 AND ultimo_numero <= rango_hasta)
);

-- Se invoca DENTRO de la misma transacción que inserta el documento. El UPDATE toma el bloqueo
-- de fila hasta el COMMIT: si la transacción falla, el número se revierte (no hay saltos) y
-- las emisiones concurrentes se serializan (no hay duplicados).
CREATE OR REPLACE FUNCTION facturacion.siguiente_numero(p_empresa uuid, p_tipo text, p_prefijo text)
RETURNS bigint AS $$
DECLARE v bigint;
BEGIN
  UPDATE facturacion.serie_documento
     SET ultimo_numero = ultimo_numero + 1
   WHERE empresa_id = p_empresa AND tipo = p_tipo AND prefijo = p_prefijo
     AND activa AND vigente_hasta >= current_date AND ultimo_numero < rango_hasta
  RETURNING ultimo_numero INTO v;
  IF v IS NULL THEN
    RAISE EXCEPTION 'R14: la serie % (%) no está disponible, vencida o agotada', p_prefijo, p_tipo USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END; $$ LANGUAGE plpgsql;

CREATE TABLE facturacion.factura (
  id                  uuid PRIMARY KEY,
  serie_id            uuid NOT NULL REFERENCES facturacion.serie_documento(id),
  prefijo             text NOT NULL,
  numero              bigint NOT NULL,
  pedido_id           uuid NOT NULL,                        -- referencia lógica a pedidos.pedido
  cliente_id          uuid NOT NULL,
  estado              text NOT NULL DEFAULT 'EMITIDA'
                      CHECK (estado IN ('EMITIDA','PAGADA_PARCIAL','PAGADA','ANULADA')),
  subtotal            numeric(18,2) NOT NULL,
  impuestos           numeric(18,2) NOT NULL,
  total               numeric(18,2) NOT NULL CHECK (total >= 0),
  saldo               numeric(18,2) NOT NULL,
  cufe                text,                                 -- validación del proveedor de facturación electrónica
  fecha_emision       timestamptz NOT NULL DEFAULT now(),
  fecha_vencimiento   date NOT NULL,
  emitida_por         uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, prefijo, numero),
  CONSTRAINT ck_r7_saldo_en_rango CHECK (saldo >= 0 AND saldo <= total),
  CONSTRAINT ck_r6_anulada_sin_saldo CHECK (estado <> 'ANULADA' OR saldo = 0),
  CONSTRAINT ck_r6_nunca_eliminada CHECK (eliminado_en IS NULL)      -- R6: no se borra, ni lógicamente
);
CREATE UNIQUE INDEX uq_factura_pedido_vigente ON facturacion.factura (empresa_id, pedido_id) WHERE estado <> 'ANULADA';
CREATE INDEX ix_factura_cliente ON facturacion.factura (empresa_id, cliente_id, estado);
CREATE INDEX ix_factura_cartera ON facturacion.factura (empresa_id, fecha_vencimiento) WHERE saldo > 0;

CREATE TABLE facturacion.factura_linea (
  id               uuid PRIMARY KEY,
  factura_id       uuid NOT NULL REFERENCES facturacion.factura(id),
  articulo_id      uuid NOT NULL,
  descripcion      text NOT NULL,
  cantidad         numeric(18,3) NOT NULL,
  precio_unitario  numeric(18,2) NOT NULL,
  iva_pct          numeric(5,2) NOT NULL,
  total_linea      numeric(18,2) NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT ck_r6_linea_nunca_eliminada CHECK (eliminado_en IS NULL)
);

-- R7: saldo = total - suma de pagos aplicados
CREATE TABLE facturacion.pago_factura (
  id                  uuid PRIMARY KEY,
  factura_id          uuid NOT NULL REFERENCES facturacion.factura(id),
  movimiento_caja_id  uuid NOT NULL UNIQUE,                 -- referencia lógica a caja.movimiento_caja (idempotencia)
  valor               numeric(18,2) NOT NULL CHECK (valor > 0),
  medio_pago          text NOT NULL,
  estado              text NOT NULL DEFAULT 'APLICADO' CHECK (estado IN ('APLICADO','REVERSADO')),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE OR REPLACE FUNCTION facturacion.fn_recalcular_saldo() RETURNS trigger AS $$
BEGIN
  WITH s AS (
    SELECT f.id,
           f.total - COALESCE((SELECT sum(p.valor) FROM facturacion.pago_factura p
                                WHERE p.factura_id = f.id AND p.estado = 'APLICADO'), 0) AS nuevo_saldo
      FROM facturacion.factura f
     WHERE f.id = NEW.factura_id AND f.estado <> 'ANULADA'
  )
  UPDATE facturacion.factura f
     SET saldo  = s.nuevo_saldo,                              -- si el pago excede el total, el CHECK ck_r7 lo rechaza
         estado = CASE WHEN s.nuevo_saldo = 0 THEN 'PAGADA'
                       WHEN s.nuevo_saldo < f.total THEN 'PAGADA_PARCIAL'
                       ELSE 'EMITIDA' END
    FROM s WHERE f.id = s.id;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_r7_saldo AFTER INSERT OR UPDATE OF valor, estado ON facturacion.pago_factura
  FOR EACH ROW EXECUTE FUNCTION facturacion.fn_recalcular_saldo();

CREATE TABLE facturacion.nota_credito (
  id          uuid PRIMARY KEY,
  factura_id  uuid NOT NULL REFERENCES facturacion.factura(id),
  prefijo     text NOT NULL,
  numero      bigint NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('ANULACION_TOTAL','PARCIAL')),
  motivo      text NOT NULL,
  total       numeric(18,2) NOT NULL CHECK (total > 0),
  emitida_por uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, prefijo, numero),
  CONSTRAINT ck_r6_nc_nunca_eliminada CHECK (eliminado_en IS NULL)
);

-- R6: los documentos fiscales no se borran
CREATE TRIGGER trg_r6_no_borrar_factura  BEFORE DELETE ON facturacion.factura
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();
CREATE TRIGGER trg_r6_no_borrar_linea    BEFORE DELETE ON facturacion.factura_linea
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();
CREATE TRIGGER trg_r6_no_borrar_nc       BEFORE DELETE ON facturacion.nota_credito
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();
CREATE TRIGGER trg_r6_no_borrar_pago     BEFORE DELETE ON facturacion.pago_factura
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();

CALL sync.habilitar('facturacion', 'factura');
CALL sync.habilitar('facturacion', 'factura_linea');
CALL sync.habilitar('facturacion', 'pago_factura');
CALL sync.habilitar('facturacion', 'nota_credito');
