-- db/scripts/100_rol_reportes.sql
CREATE ROLE reportes_ro LOGIN PASSWORD 'CAMBIAR_ESTA_CLAVE';
GRANT USAGE ON SCHEMA seguridad, catalogo, pedidos, inventarios, fabricacion, facturacion, caja, compras, despacho TO reportes_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA seguridad, catalogo, pedidos, inventarios, fabricacion, facturacion, caja, compras, despacho TO reportes_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos, inventarios, fabricacion, facturacion, caja, compras, despacho, catalogo
  GRANT SELECT ON TABLES TO reportes_ro;
-- Las políticas RLS de la sección 6.13 son para el rol "authenticated". Este rol de servicio las omite
-- (el filtro por empresa se aplica siempre en las consultas):
ALTER ROLE reportes_ro BYPASSRLS;
