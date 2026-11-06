-- db/scripts/020_inventarios.sql
CREATE TABLE inventarios.bodega (
  id        uuid PRIMARY KEY,
  codigo    text NOT NULL,
  nombre    text NOT NULL,
  activa    boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, codigo)
);

-- Existencias: NADIE las modifica directamente; cambian solo por el trigger del kardex (R5).
CREATE TABLE inventarios.existencia (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id          uuid NOT NULL,                       -- referencia lógica a catalogo.articulo
  bodega_id            uuid NOT NULL REFERENCES inventarios.bodega(id),
  cantidad_fisica      numeric(18,3) NOT NULL DEFAULT 0,
  cantidad_reservada   numeric(18,3) NOT NULL DEFAULT 0,
  cantidad_disponible  numeric(18,3) GENERATED ALWAYS AS (cantidad_fisica - cantidad_reservada) STORED,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, articulo_id, bodega_id),
  CONSTRAINT ck_existencia_fisica_no_negativa  CHECK (cantidad_fisica >= 0),
  CONSTRAINT ck_existencia_reserva_no_negativa CHECK (cantidad_reservada >= 0),
  -- R3: lo reservado no puede volver a venderse (nunca se reserva más de lo que hay)
  CONSTRAINT ck_r3_reservado_no_excede_fisico  CHECK (cantidad_reservada <= cantidad_fisica)
);

-- R12: reservas de stock por línea de pedido. Despachar = consumir una reserva ACTIVA.
CREATE TABLE inventarios.reserva_stock (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  articulo_id       uuid NOT NULL,
  bodega_id         uuid NOT NULL,
  pedido_id         uuid NOT NULL,                          -- referencia lógica a pedidos.pedido
  pedido_linea_id   uuid NOT NULL,
  cantidad          numeric(18,3) NOT NULL CHECK (cantidad > 0),
  estado            text NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','CONSUMIDA','LIBERADA')),
  clave_idempotencia text NOT NULL,                         -- evita reservar dos veces ante reintentos
  referencia_despacho uuid,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, clave_idempotencia)
);
CREATE INDEX ix_reserva_pedido ON inventarios.reserva_stock (pedido_id, estado);

-- R5: kardex inmutable. delta_fisico y delta_reservado permiten derivar siempre el saldo.
CREATE TABLE inventarios.kardex (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  articulo_id       uuid NOT NULL,
  bodega_id         uuid NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN (
                      'ENTRADA_COMPRA','ENTRADA_PRODUCCION','SALIDA_DESPACHO',
                      'AJUSTE_POSITIVO','AJUSTE_NEGATIVO','RESERVA','LIBERACION')),
  delta_fisico      numeric(18,3) NOT NULL DEFAULT 0,
  delta_reservado   numeric(18,3) NOT NULL DEFAULT 0,
  costo_unitario    numeric(18,4),
  referencia_tipo   text,                                   -- 'pedidos.pedido', 'compras.recepcion', 'fabricacion.orden'
  referencia_id     uuid,
  idempotencia      text,
  usuario_id        uuid,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, idempotencia),
  CHECK (delta_fisico <> 0 OR delta_reservado <> 0)
);
CREATE INDEX ix_kardex_articulo ON inventarios.kardex (empresa_id, articulo_id, bodega_id, creado_en DESC);

CREATE TRIGGER trg_kardex_inmutable BEFORE UPDATE OR DELETE ON inventarios.kardex
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_modificacion();

-- R5: toda variación de existencia nace de un asiento del kardex
CREATE OR REPLACE FUNCTION inventarios.fn_aplicar_kardex() RETURNS trigger AS $$
BEGIN
  UPDATE inventarios.existencia
     SET cantidad_fisica    = cantidad_fisica    + NEW.delta_fisico,
         cantidad_reservada = cantidad_reservada + NEW.delta_reservado
   WHERE empresa_id = NEW.empresa_id AND articulo_id = NEW.articulo_id AND bodega_id = NEW.bodega_id;
  IF NOT FOUND THEN
    INSERT INTO inventarios.existencia (empresa_id, articulo_id, bodega_id, cantidad_fisica, cantidad_reservada)
    VALUES (NEW.empresa_id, NEW.articulo_id, NEW.bodega_id, NEW.delta_fisico, NEW.delta_reservado);
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kardex_aplicar AFTER INSERT ON inventarios.kardex
  FOR EACH ROW EXECUTE FUNCTION inventarios.fn_aplicar_kardex();

-- Saldo derivado del kardex y verificación de consistencia (debe devolver 0 filas)
CREATE VIEW inventarios.v_saldo_kardex AS
SELECT empresa_id, articulo_id, bodega_id,
       sum(delta_fisico) AS saldo_fisico, sum(delta_reservado) AS saldo_reservado
  FROM inventarios.kardex GROUP BY empresa_id, articulo_id, bodega_id;

CREATE VIEW inventarios.v_inconsistencias_kardex AS
SELECT e.empresa_id, e.articulo_id, e.bodega_id,
       e.cantidad_fisica, COALESCE(k.saldo_fisico, 0) AS kardex_fisico,
       e.cantidad_reservada, COALESCE(k.saldo_reservado, 0) AS kardex_reservado
  FROM inventarios.existencia e
  LEFT JOIN inventarios.v_saldo_kardex k USING (empresa_id, articulo_id, bodega_id)
 WHERE e.cantidad_fisica <> COALESCE(k.saldo_fisico, 0)
    OR e.cantidad_reservada <> COALESCE(k.saldo_reservado, 0);

-- Conteos físicos (bodeguero). Al cerrar el conteo se generan ajustes en el kardex.
CREATE TABLE inventarios.conteo (
  id            uuid PRIMARY KEY,
  bodega_id     uuid NOT NULL REFERENCES inventarios.bodega(id),
  estado        text NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
  realizado_por uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);
CREATE TABLE inventarios.conteo_linea (
  id                uuid PRIMARY KEY,
  conteo_id         uuid NOT NULL REFERENCES inventarios.conteo(id),
  articulo_id       uuid NOT NULL,
  cantidad_sistema  numeric(18,3) NOT NULL,
  cantidad_contada  numeric(18,3) NOT NULL CHECK (cantidad_contada >= 0),
  diferencia        numeric(18,3) GENERATED ALWAYS AS (cantidad_contada - cantidad_sistema) STORED,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CALL sync.habilitar('inventarios', 'bodega');
CALL sync.habilitar('inventarios', 'existencia');
CALL sync.habilitar('inventarios', 'conteo');
CALL sync.habilitar('inventarios', 'conteo_linea');
