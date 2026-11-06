-- db/scripts/060_caja.sql
CREATE TABLE caja.caja (
  id        uuid PRIMARY KEY,
  codigo    text NOT NULL,
  nombre    text NOT NULL,
  activa    boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE caja.sesion_caja (
  id                      uuid PRIMARY KEY,
  caja_id                 uuid NOT NULL REFERENCES caja.caja(id),
  usuario_id              uuid NOT NULL,
  estado                  text NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA','CERRADA')),
  monto_apertura          numeric(18,2) NOT NULL DEFAULT 0 CHECK (monto_apertura >= 0),
  abierta_en              timestamptz NOT NULL DEFAULT now(),
  cerrada_en              timestamptz,
  monto_cierre_declarado  numeric(18,2),
  monto_cierre_sistema    numeric(18,2),
  diferencia              numeric(18,2),
  -- R8: columnas generadas que solo tienen valor mientras la sesión está ABIERTA.
  -- UNIQUE permite muchos NULL (sesiones cerradas) y un único valor (sesión abierta).
  caja_abierta     uuid GENERATED ALWAYS AS (CASE WHEN estado = 'ABIERTA' THEN caja_id END) STORED,
  usuario_abierto  uuid GENERATED ALWAYS AS (CASE WHEN estado = 'ABIERTA' THEN usuario_id END) STORED,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT uq_r8_una_abierta_por_caja    UNIQUE (caja_abierta),
  CONSTRAINT uq_r8_una_abierta_por_usuario UNIQUE (usuario_abierto),
  CHECK (estado = 'ABIERTA' OR cerrada_en IS NOT NULL)
);

-- R9 y R10: movimientos inmutables; los errores se corrigen con un REVERSO
CREATE TABLE caja.movimiento_caja (
  id                        uuid PRIMARY KEY,
  sesion_id                 uuid NOT NULL REFERENCES caja.sesion_caja(id),
  tipo                      text NOT NULL CHECK (tipo IN ('COBRO','PAGO','INGRESO','EGRESO','REVERSO')),
  sentido                   text NOT NULL CHECK (sentido IN ('ENTRADA','SALIDA')),
  medio_pago                text NOT NULL CHECK (medio_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA','CHEQUE')),
  valor                     numeric(18,2) NOT NULL CHECK (valor > 0),
  -- R10: solo token / código de autorización de la pasarela. Nunca el número de tarjeta.
  referencia                text,
  pedido_id                 uuid,
  factura_id                uuid,
  id_movimiento_relacionado uuid REFERENCES caja.movimiento_caja(id),   -- R9
  idempotency_key           uuid NOT NULL UNIQUE,
  usuario_id                uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT ck_r9_reverso_referencia CHECK ((tipo = 'REVERSO') = (id_movimiento_relacionado IS NOT NULL)),
  CONSTRAINT uq_r9_un_reverso_por_movimiento UNIQUE (id_movimiento_relacionado),
  CONSTRAINT ck_r10_tarjeta_requiere_referencia CHECK (medio_pago <> 'TARJETA' OR (referencia IS NOT NULL AND length(referencia) >= 6)),
  CONSTRAINT ck_r10_referencia_no_es_pan CHECK (referencia IS NULL OR regexp_replace(referencia, '[ -]', '', 'g') !~ '^[0-9]{13,19}$')
);
CREATE INDEX ix_mov_sesion ON caja.movimiento_caja (sesion_id, creado_en);

CREATE TRIGGER trg_r9_inmutable BEFORE UPDATE OR DELETE ON caja.movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_modificacion();

-- R9: el reverso debe ser exactamente inverso del movimiento original
CREATE OR REPLACE FUNCTION caja.fn_validar_reverso() RETURNS trigger AS $$
DECLARE o caja.movimiento_caja%ROWTYPE;
BEGIN
  IF NEW.tipo <> 'REVERSO' THEN RETURN NEW; END IF;
  SELECT * INTO o FROM caja.movimiento_caja WHERE id = NEW.id_movimiento_relacionado;
  IF NOT FOUND OR o.empresa_id <> NEW.empresa_id THEN
    RAISE EXCEPTION 'R9: el movimiento a reversar no existe' USING ERRCODE = '23514';
  END IF;
  IF o.tipo = 'REVERSO' THEN
    RAISE EXCEPTION 'R9: no se puede reversar un reverso' USING ERRCODE = '23514';
  END IF;
  IF o.sentido = NEW.sentido OR o.valor <> NEW.valor OR o.medio_pago <> NEW.medio_pago THEN
    RAISE EXCEPTION 'R9: el reverso debe tener sentido contrario y el mismo valor y medio de pago' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_r9_validar_reverso BEFORE INSERT ON caja.movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION caja.fn_validar_reverso();

-- Arqueos (parciales y de cierre)
CREATE TABLE caja.arqueo (
  id                uuid PRIMARY KEY,
  sesion_id         uuid NOT NULL REFERENCES caja.sesion_caja(id),
  tipo              text NOT NULL CHECK (tipo IN ('PARCIAL','CIERRE')),
  efectivo_contado  numeric(18,2) NOT NULL CHECK (efectivo_contado >= 0),
  efectivo_esperado numeric(18,2) NOT NULL,
  diferencia        numeric(18,2) GENERATED ALWAYS AS (efectivo_contado - efectivo_esperado) STORED,
  denominaciones    jsonb,                                  -- {"50000": 10, "20000": 5, ...}
  observacion       text,
  arqueado_por      uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

-- Saldo de efectivo esperado de una sesión (apertura + entradas - salidas en efectivo)
CREATE VIEW caja.v_saldo_efectivo_sesion AS
SELECT s.id AS sesion_id, s.empresa_id,
       s.monto_apertura + COALESCE(sum(CASE WHEN m.sentido = 'ENTRADA' THEN m.valor ELSE -m.valor END)
                                   FILTER (WHERE m.medio_pago = 'EFECTIVO'), 0) AS efectivo_esperado
  FROM caja.sesion_caja s LEFT JOIN caja.movimiento_caja m ON m.sesion_id = s.id
 GROUP BY s.id, s.empresa_id, s.monto_apertura;

CALL sync.habilitar('caja', 'caja');
CALL sync.habilitar('caja', 'sesion_caja');
CALL sync.habilitar('caja', 'movimiento_caja');
CALL sync.habilitar('caja', 'arqueo');
