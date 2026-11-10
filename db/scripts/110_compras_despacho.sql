-- db/scripts/110_compras_despacho.sql
-- Migración: módulos Compras y Despacho completos. Idempotente (se puede ejecutar más de una vez).
BEGIN;

-- ===================== COMPRAS =====================
ALTER TABLE compras.orden_compra
  ADD COLUMN IF NOT EXISTS aprobado_en      timestamptz,
  ADD COLUMN IF NOT EXISTS enviada_en       timestamptz,
  ADD COLUMN IF NOT EXISTS fecha_esperada   date,
  ADD COLUMN IF NOT EXISTS motivo_anulacion text,
  ADD COLUMN IF NOT EXISTS observaciones    text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_oc_numero ON compras.orden_compra (empresa_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_oc_estado ON compras.orden_compra (empresa_id, estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_oc_proveedor ON compras.orden_compra (empresa_id, proveedor_id);
CREATE INDEX IF NOT EXISTS ix_oc_linea_orden ON compras.orden_compra_linea (orden_id) WHERE eliminado_en IS NULL;
CREATE INDEX IF NOT EXISTS ix_recepcion_orden ON compras.recepcion (orden_id);

-- Consecutivos por empresa y serie (se incrementan dentro de la transacción de negocio)
CREATE TABLE IF NOT EXISTS compras.consecutivo (
  empresa_id uuid NOT NULL, serie text NOT NULL, ultimo bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, serie)
);

-- Lo que el bodeguero espera recibir
CREATE OR REPLACE VIEW compras.v_pendiente_recibir AS
SELECT o.empresa_id, o.id AS orden_id, o.numero, o.bodega_id, o.proveedor_id, p.razon_social AS proveedor,
       o.fecha_esperada, l.id AS orden_linea_id, l.articulo_id, l.cantidad, l.cantidad_recibida,
       l.cantidad - l.cantidad_recibida AS pendiente, l.costo_unitario
  FROM compras.orden_compra o
  JOIN compras.orden_compra_linea l ON l.orden_id = o.id AND l.eliminado_en IS NULL
  JOIN compras.proveedor p ON p.id = o.proveedor_id
 WHERE o.eliminado_en IS NULL AND o.estado IN ('ENVIADA','RECIBIDA_PARCIAL') AND l.cantidad_recibida < l.cantidad;

-- ===================== DESPACHO =====================
ALTER TABLE despacho.despacho
  ADD COLUMN IF NOT EXISTS fecha_programada date,
  ADD COLUMN IF NOT EXISTS receptor         text,
  ADD COLUMN IF NOT EXISTS motivo_fallo     text,
  ADD COLUMN IF NOT EXISTS intentos_entrega int NOT NULL DEFAULT 0;

ALTER TABLE despacho.despacho DROP CONSTRAINT IF EXISTS despacho_estado_check;
ALTER TABLE despacho.despacho ADD CONSTRAINT despacho_estado_check
  CHECK (estado IN ('PROGRAMADO','DESPACHADO','ENTREGADO','FALLIDO','CANCELADO'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_despacho_numero ON despacho.despacho (empresa_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_despacho_pedido ON despacho.despacho (empresa_id, pedido_id);
CREATE INDEX IF NOT EXISTS ix_despacho_estado ON despacho.despacho (empresa_id, estado, creado_en DESC);

-- Una reserva respalda una sola línea de despacho vigente (las canceladas se borran lógicamente)
CREATE UNIQUE INDEX IF NOT EXISTS ux_despacho_linea_reserva ON despacho.despacho_linea (reserva_id) WHERE eliminado_en IS NULL;

CREATE TABLE IF NOT EXISTS despacho.consecutivo (
  empresa_id uuid NOT NULL, serie text NOT NULL, ultimo bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, serie)
);

-- Pedidos confirmados con reserva ACTIVA todavía no asignada a un despacho vigente
CREATE OR REPLACE VIEW despacho.v_listo_para_despachar AS
SELECT r.empresa_id, r.pedido_id, r.bodega_id, r.pedido_linea_id, r.articulo_id, r.id AS reserva_id, r.cantidad
  FROM inventarios.reserva_stock r
 WHERE r.estado = 'ACTIVA'
   AND NOT EXISTS (SELECT 1 FROM despacho.despacho_linea dl
                    JOIN despacho.despacho d ON d.id = dl.despacho_id
                   WHERE dl.reserva_id = r.id AND dl.eliminado_en IS NULL AND d.estado <> 'CANCELADO');

-- R12 (respaldo en BD): no hay SALIDA_DESPACHO sin una reserva que la respalde
CREATE OR REPLACE FUNCTION despacho.fn_r12_validar_despacho() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'DESPACHADO' AND OLD.estado IS DISTINCT FROM 'DESPACHADO' AND OLD.estado = 'PROGRAMADO' THEN
    IF NOT EXISTS (SELECT 1 FROM despacho.despacho_linea WHERE despacho_id = NEW.id AND eliminado_en IS NULL) THEN
      RAISE EXCEPTION 'R12: el despacho % no tiene líneas con reserva de stock', COALESCE(NEW.numero, NEW.id::text)
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM despacho.despacho_linea dl
                LEFT JOIN inventarios.reserva_stock r ON r.id = dl.reserva_id
               WHERE dl.despacho_id = NEW.id AND dl.eliminado_en IS NULL
                 AND (r.id IS NULL OR r.estado <> 'CONSUMIDA')) THEN
      RAISE EXCEPTION 'R12: el despacho % tiene líneas cuya reserva no fue consumida', COALESCE(NEW.numero, NEW.id::text)
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_r12_despacho ON despacho.despacho;
CREATE TRIGGER trg_r12_despacho BEFORE UPDATE OF estado ON despacho.despacho
  FOR EACH ROW EXECUTE FUNCTION despacho.fn_r12_validar_despacho();

-- ===================== PERMISOS =====================
INSERT INTO seguridad.permiso (codigo) VALUES ('compras.orden.ver'), ('despacho.despacho.ver') ON CONFLICT DO NOTHING;

INSERT INTO seguridad.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('comprador','compras.orden.ver'), ('bodeguero','compras.orden.ver'), ('contador','compras.orden.ver'),
    ('bodeguero','despacho.despacho.ver'), ('vendedor','despacho.despacho.ver'),
    ('supervisor_ventas','despacho.despacho.ver'), ('contador','despacho.despacho.ver'),
    ('comprador','compras.recepcion.registrar')
  ) v(rol, permiso)
  JOIN seguridad.rol r ON r.codigo = v.rol
  JOIN seguridad.permiso p ON p.codigo = v.permiso
ON CONFLICT DO NOTHING;

-- El administrador recibe los permisos nuevos
INSERT INTO seguridad.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM seguridad.rol r CROSS JOIN seguridad.permiso p
 WHERE r.codigo = 'administrador' ON CONFLICT DO NOTHING;

COMMIT;
