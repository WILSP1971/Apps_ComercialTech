-- db/scripts/080_seguridad_rls.sql
CREATE OR REPLACE FUNCTION seguridad.empresas_del_usuario() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT empresa_id FROM seguridad.usuario_empresa WHERE usuario_id = auth.uid() AND activo
$$;

-- Lectura por empresa en todas las tablas con empresa_id
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT table_schema, table_name FROM information_schema.columns
    WHERE column_name = 'empresa_id'
      AND table_schema IN ('catalogo','pedidos','inventarios','fabricacion','facturacion','caja','compras','despacho')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format($f$CREATE POLICY p_lectura_empresa ON %I.%I FOR SELECT TO authenticated
                      USING (empresa_id IN (SELECT seguridad.empresas_del_usuario()))$f$,
                   t.table_schema, t.table_name);
  END LOOP;
END $$;

-- Tabla "señal" liviana: Realtime avisa de cambios sin exponer datos de negocio
CREATE TABLE IF NOT EXISTS sync.senal (
  empresa_id  uuid PRIMARY KEY,
  secuencia   bigint NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sync.senal ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_senal_lectura ON sync.senal FOR SELECT TO authenticated
  USING (empresa_id IN (SELECT seguridad.empresas_del_usuario()));
ALTER PUBLICATION supabase_realtime ADD TABLE sync.senal;

CREATE OR REPLACE FUNCTION sync.fn_actualizar_senal() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync.senal (empresa_id, secuencia) VALUES (NEW.empresa_id, NEW.secuencia)
  ON CONFLICT (empresa_id) DO UPDATE SET secuencia = EXCLUDED.secuencia, actualizado = now();
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_senal AFTER INSERT ON sync.cambios
FOR EACH ROW EXECUTE FUNCTION sync.fn_actualizar_senal();
