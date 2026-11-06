-- db/scripts/070_despacho.sql
CREATE TABLE despacho.despacho (
  id                 uuid PRIMARY KEY,
  numero             text,
  pedido_id          uuid NOT NULL,                         -- referencia lógica a pedidos.pedido
  cliente_id         uuid NOT NULL,
  bodega_id          uuid NOT NULL,
  direccion_entrega  text NOT NULL,
  estado             text NOT NULL DEFAULT 'PROGRAMADO'
                     CHECK (estado IN ('PROGRAMADO','DESPACHADO','ENTREGADO','FALLIDO')),
  transportador      text,
  guia               text,
  despachado_por     uuid,
  despachado_en      timestamptz,
  entregado_en       timestamptz,
  evidencia_url      text,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

-- R12: cada línea despachada exige la reserva de stock que respalda la salida.
-- La validación de que la reserva esté ACTIVA la hace InventariosApi.consumirReservas()
-- en la misma transacción (no hay FK entre esquemas).
CREATE TABLE despacho.despacho_linea (
  id               uuid PRIMARY KEY,
  despacho_id      uuid NOT NULL REFERENCES despacho.despacho(id),
  pedido_linea_id  uuid NOT NULL,
  articulo_id      uuid NOT NULL,
  cantidad         numeric(18,3) NOT NULL CHECK (cantidad > 0),
  reserva_id       uuid NOT NULL,                           -- reserva consumida
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CALL sync.habilitar('despacho', 'despacho');
CALL sync.habilitar('despacho', 'despacho_linea');
