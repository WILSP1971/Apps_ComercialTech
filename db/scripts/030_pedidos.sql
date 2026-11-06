-- db/scripts/030_pedidos.sql

-- Modelo de cliente propio del contexto Pedidos (se alimenta con eventos de catalogo.cliente).
-- Aquí vive el límite de crédito (R13).
CREATE TABLE pedidos.cliente (
  id                uuid PRIMARY KEY,                       -- = catalogo.cliente.id
  numero_documento  text NOT NULL,
  razon_social      text NOT NULL,
  limite_credito    numeric(18,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
  credito_usado     numeric(18,2) NOT NULL DEFAULT 0 CHECK (credito_usado >= 0),
  bloqueado         boolean NOT NULL DEFAULT false,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE pedidos.pedido (
  id                uuid PRIMARY KEY,
  numero            text,                                   -- lo asigna el servidor al confirmar
  cliente_id        uuid NOT NULL REFERENCES pedidos.cliente(id),
  vendedor_id       uuid NOT NULL,
  bodega_id         uuid NOT NULL,                          -- referencia lógica a inventarios.bodega
  canal             text NOT NULL DEFAULT 'MOSTRADOR' CHECK (canal IN ('MOSTRADOR','WEB','TELEFONO')),
  condicion_pago    text NOT NULL DEFAULT 'CONTADO' CHECK (condicion_pago IN ('CONTADO','CREDITO')),
  estado            text NOT NULL DEFAULT 'BORRADOR'
                    CHECK (estado IN ('BORRADOR','PENDIENTE_APROBACION','CONFIRMADO','DESPACHADO','CANCELADO','RECHAZADO')),
  motivo_rechazo    text,
  direccion_entrega text,
  observaciones     text,
  subtotal          numeric(18,2) NOT NULL DEFAULT 0,
  impuestos         numeric(18,2) NOT NULL DEFAULT 0,
  total             numeric(18,2) NOT NULL DEFAULT 0,
  moneda            char(3) NOT NULL DEFAULT 'COP',
  factura_id        uuid,                                   -- referencia lógica a facturacion.factura
  creado_offline    boolean NOT NULL DEFAULT false,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, numero)
);
CREATE INDEX ix_pedido_cliente ON pedidos.pedido (empresa_id, cliente_id, creado_en DESC);
CREATE INDEX ix_pedido_estado  ON pedidos.pedido (empresa_id, estado);

-- R2: cada línea puede tener una parte reservada de stock y otra parte a fabricar
CREATE TABLE pedidos.pedido_linea (
  id                    uuid PRIMARY KEY,
  pedido_id             uuid NOT NULL REFERENCES pedidos.pedido(id),
  articulo_id           uuid NOT NULL,                      -- referencia lógica a catalogo.articulo
  descripcion           text NOT NULL,
  cantidad              numeric(18,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario       numeric(18,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento_pct         numeric(5,2)  NOT NULL DEFAULT 0 CHECK (descuento_pct BETWEEN 0 AND 100),
  iva_pct               numeric(5,2)  NOT NULL DEFAULT 0,
  total_linea           numeric(18,2) NOT NULL,
  cantidad_reservada    numeric(18,3) NOT NULL DEFAULT 0 CHECK (cantidad_reservada >= 0),
  cantidad_a_fabricar   numeric(18,3) NOT NULL DEFAULT 0 CHECK (cantidad_a_fabricar >= 0),
  estado_abastecimiento text NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado_abastecimiento IN ('PENDIENTE','RESERVADO','EN_FABRICACION','MIXTO')),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT ck_r2_reservado_mas_fabricar CHECK (cantidad_reservada + cantidad_a_fabricar <= cantidad)
);
CREATE INDEX ix_pedido_linea_pedido ON pedidos.pedido_linea (pedido_id);

-- Trazabilidad de aprobaciones del supervisor (R13)
CREATE TABLE pedidos.aprobacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid NOT NULL REFERENCES pedidos.pedido(id),
  motivo           text NOT NULL DEFAULT 'LIMITE_CREDITO',
  valor_excedido   numeric(18,2) NOT NULL,
  decision         text CHECK (decision IN ('APROBADO','RECHAZADO')),
  decidida_por     uuid,
  decidida_en      timestamptz,
  comentario       text,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE pedidos.consecutivo (
  empresa_id uuid NOT NULL,
  serie      text NOT NULL,
  ultimo     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, serie)
);

CALL sync.habilitar('pedidos', 'cliente');
CALL sync.habilitar('pedidos', 'pedido');
CALL sync.habilitar('pedidos', 'pedido_linea');
CALL sync.habilitar('pedidos', 'aprobacion');
