-- db/scripts/040_compras.sql
CREATE TABLE compras.proveedor (
  id            uuid PRIMARY KEY,
  nit           text NOT NULL,
  razon_social  text NOT NULL,
  correo        citext,
  telefono      text,
  plazo_dias    int NOT NULL DEFAULT 0,
  activo        boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, nit)
);

CREATE TABLE compras.orden_compra (
  id            uuid PRIMARY KEY,
  numero        text,
  proveedor_id  uuid NOT NULL REFERENCES compras.proveedor(id),
  bodega_id     uuid NOT NULL,
  estado        text NOT NULL DEFAULT 'BORRADOR'
                CHECK (estado IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','ENVIADA',
                                  'RECIBIDA_PARCIAL','RECIBIDA','CERRADA','ANULADA')),
  total         numeric(18,2) NOT NULL DEFAULT 0,
  creado_por    uuid NOT NULL,
  aprobado_por  uuid,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE compras.orden_compra_linea (
  id                 uuid PRIMARY KEY,
  orden_id           uuid NOT NULL REFERENCES compras.orden_compra(id),
  articulo_id        uuid NOT NULL,
  cantidad           numeric(18,3) NOT NULL CHECK (cantidad > 0),
  cantidad_recibida  numeric(18,3) NOT NULL DEFAULT 0,
  costo_unitario     numeric(18,4) NOT NULL CHECK (costo_unitario >= 0),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad)
);

CREATE TABLE compras.recepcion (
  id            uuid PRIMARY KEY,
  orden_id      uuid NOT NULL REFERENCES compras.orden_compra(id),
  recibido_por  uuid NOT NULL,
  observaciones text,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE compras.recepcion_linea (
  id                uuid PRIMARY KEY,
  recepcion_id      uuid NOT NULL REFERENCES compras.recepcion(id),
  orden_linea_id    uuid NOT NULL REFERENCES compras.orden_compra_linea(id),
  articulo_id       uuid NOT NULL,
  cantidad          numeric(18,3) NOT NULL CHECK (cantidad > 0),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

-- R11: una orden de compra no se cierra hasta recibir toda la mercadería
CREATE OR REPLACE FUNCTION compras.fn_validar_cierre_oc() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM compras.orden_compra_linea l
              WHERE l.orden_id = NEW.id AND l.eliminado_en IS NULL AND l.cantidad_recibida < l.cantidad) THEN
    RAISE EXCEPTION 'R11: la orden de compra % no puede cerrarse: hay mercadería sin recibir', COALESCE(NEW.numero, NEW.id::text)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_r11_cierre_oc BEFORE UPDATE OF estado ON compras.orden_compra
  FOR EACH ROW WHEN (NEW.estado = 'CERRADA' AND OLD.estado IS DISTINCT FROM 'CERRADA')
  EXECUTE FUNCTION compras.fn_validar_cierre_oc();

CALL sync.habilitar('compras', 'proveedor');
CALL sync.habilitar('compras', 'orden_compra');
CALL sync.habilitar('compras', 'orden_compra_linea');
CALL sync.habilitar('compras', 'recepcion');
CALL sync.habilitar('compras', 'recepcion_linea');
