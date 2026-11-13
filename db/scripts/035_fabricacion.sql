-- db/scripts/035_fabricacion.sql
CREATE SEQUENCE fabricacion.seq_orden_fabricacion;

CREATE TABLE fabricacion.orden_fabricacion (
  id                 uuid PRIMARY KEY,
  numero             text NOT NULL,
  articulo_id        uuid NOT NULL,                         -- referencia lógica a catalogo.articulo
  cantidad           numeric(18,3) NOT NULL CHECK (cantidad > 0),
  cantidad_producida numeric(18,3) NOT NULL DEFAULT 0 CHECK (cantidad_producida >= 0),
  estado             text NOT NULL DEFAULT 'PLANIFICADA'
                     CHECK (estado IN ('PLANIFICADA','LIBERADA','EN_PROCESO','TERMINADA','CANCELADA')),
  pedido_id          uuid,                                  -- origen (referencia lógica)
  pedido_linea_id    uuid,
  clave_origen       text NOT NULL,                         -- 'pedido_linea:<uuid>' o 'manual:<uuid>'
  bodega_destino_id  uuid NOT NULL,
  fecha_programada   date,
  liberada_por       uuid,
  liberada_en        timestamptz,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, numero),
  -- R4: una OF por línea de pedido como máximo, aunque el evento se reintente
  CONSTRAINT uq_r4_clave_origen UNIQUE (empresa_id, clave_origen)
);
CREATE INDEX ix_of_estado ON fabricacion.orden_fabricacion (empresa_id, estado);

-- Reportes de producción (inmutables, idempotentes)
CREATE TABLE fabricacion.reporte_produccion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  orden_id         uuid NOT NULL REFERENCES fabricacion.orden_fabricacion(id),
  cantidad         numeric(18,3) NOT NULL CHECK (cantidad > 0),
  reportado_por    uuid NOT NULL,
  idempotency_key  uuid NOT NULL UNIQUE,
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_reporte_inmutable BEFORE UPDATE OR DELETE ON fabricacion.reporte_produccion
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_modificacion();

CALL sync.habilitar('fabricacion', 'orden_fabricacion');
