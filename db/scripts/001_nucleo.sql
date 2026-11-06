-- db/scripts/001_nucleo.sql
CREATE SCHEMA IF NOT EXISTS nucleo;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS seguridad;
CREATE SCHEMA IF NOT EXISTS catalogo;
CREATE SCHEMA IF NOT EXISTS pedidos;
CREATE SCHEMA IF NOT EXISTS inventarios;
CREATE SCHEMA IF NOT EXISTS fabricacion;
CREATE SCHEMA IF NOT EXISTS facturacion;
CREATE SCHEMA IF NOT EXISTS caja;
CREATE SCHEMA IF NOT EXISTS compras;
CREATE SCHEMA IF NOT EXISTS despacho;

-- ===== Plantilla de columnas de las tablas sincronizables =====
CREATE TABLE nucleo.plantilla_sync (
  empresa_id      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);

-- ===== Funciones de inmutabilidad (R6, R9, R5) =====
CREATE OR REPLACE FUNCTION nucleo.fn_bloquear_modificacion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla %.% es inmutable: no admite % (corrija con un registro inverso)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION nucleo.fn_bloquear_borrado() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'No se pueden borrar registros de %.% (use anulación o un movimiento inverso)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'P0001';
END; $$ LANGUAGE plpgsql;

-- ===== Outbox de eventos de dominio (Transactional Outbox) =====
CREATE TABLE nucleo.evento_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  tipo           text NOT NULL,              -- 'pedidos.PedidoConfirmado'
  agregado_id    uuid NOT NULL,
  payload        jsonb NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  procesado_en   timestamptz,
  intentos       int NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_pendientes ON nucleo.evento_outbox (creado_en) WHERE procesado_en IS NULL;

-- ===== Auditoría =====
CREATE TABLE nucleo.auditoria (
  id          bigserial PRIMARY KEY,
  empresa_id  uuid,
  usuario_id  uuid,
  accion      text NOT NULL,
  entidad     text NOT NULL,
  entidad_id  uuid,
  detalle     jsonb,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

-- ===== Sincronización =====
CREATE TABLE sync.cambios (
  secuencia    bigserial PRIMARY KEY,
  empresa_id   uuid NOT NULL,
  tabla        text NOT NULL,                -- 'pedidos.pedido'
  registro_id  uuid NOT NULL,
  operacion    char(1) NOT NULL CHECK (operacion IN ('I','U','D')),
  version      int NOT NULL,
  payload      jsonb NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cambios_empresa_secuencia ON sync.cambios (empresa_id, secuencia);

CREATE TABLE sync.operacion_procesada (
  idempotency_key  uuid PRIMARY KEY,
  empresa_id       uuid NOT NULL,
  dispositivo_id   uuid NOT NULL,
  tipo             text NOT NULL,
  resultado        jsonb NOT NULL,
  procesado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync.dispositivo (
  id                 uuid PRIMARY KEY,
  empresa_id         uuid NOT NULL,
  usuario_id         uuid NOT NULL,
  nombre             text,
  ultima_sync        timestamptz
);

-- Trigger genérico: controla versión/fechas y registra el cambio en el log.
CREATE OR REPLACE FUNCTION sync.fn_registrar_cambio() RETURNS trigger AS $$
DECLARE
  v_op char(1);
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.version        := 1;
      NEW.creado_en      := COALESCE(NEW.creado_en, now());
      NEW.actualizado_en := now();
    ELSE
      NEW.version        := OLD.version + 1;
      NEW.actualizado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  -- AFTER: el bloqueo consultivo serializa la asignación de 'secuencia' para que los clientes
  -- no se salten cambios (una secuencia menor confirmada después de una mayor).
  PERFORM pg_advisory_xact_lock(7001);
  v_op := CASE WHEN TG_OP = 'INSERT' THEN 'I'
               WHEN NEW.eliminado_en IS NOT NULL THEN 'D'
               ELSE 'U' END;
  INSERT INTO sync.cambios (empresa_id, tabla, registro_id, operacion, version, payload)
  VALUES (NEW.empresa_id, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, v_op, NEW.version, to_jsonb(NEW));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE sync.habilitar(p_esquema text, p_tabla text) AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER trg_sync_antes BEFORE INSERT OR UPDATE ON %I.%I
                  FOR EACH ROW EXECUTE FUNCTION sync.fn_registrar_cambio()', p_esquema, p_tabla);
  EXECUTE format('CREATE TRIGGER trg_sync_despues AFTER INSERT OR UPDATE ON %I.%I
                  FOR EACH ROW EXECUTE FUNCTION sync.fn_registrar_cambio()', p_esquema, p_tabla);
END;
$$ LANGUAGE plpgsql;
