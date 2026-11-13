-- db/scripts/010_catalogo.sql
CREATE TABLE catalogo.articulo (
  id                uuid PRIMARY KEY,
  sku               text NOT NULL,
  nombre            text NOT NULL,
  descripcion       text,
  unidad_medida     text NOT NULL DEFAULT 'UND',
  precio_lista      numeric(18,2) NOT NULL DEFAULT 0 CHECK (precio_lista >= 0),
  porcentaje_iva    numeric(5,2)  NOT NULL DEFAULT 19,
  es_fabricable     boolean NOT NULL DEFAULT false,   -- R1: si falta stock genera OF
  maneja_inventario boolean NOT NULL DEFAULT true,
  publicado_web     boolean NOT NULL DEFAULT false,   -- visible en el e-commerce
  activo            boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, sku)
);
CREATE INDEX ix_articulo_busqueda ON catalogo.articulo USING gin (nombre gin_trgm_ops);

CREATE TABLE catalogo.cliente (
  id                uuid PRIMARY KEY,
  tipo_documento    text NOT NULL CHECK (tipo_documento IN ('CC','NIT','CE','PAS')),
  numero_documento  text NOT NULL,
  razon_social      text NOT NULL,
  correo            citext,
  telefono          text,
  direccion         text,
  ciudad            text,
  vendedor_id       uuid,                         -- usuario responsable
  activo            boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, tipo_documento, numero_documento)
);
CREATE INDEX ix_cliente_busqueda ON catalogo.cliente USING gin (razon_social gin_trgm_ops);

CALL sync.habilitar('catalogo', 'articulo');
CALL sync.habilitar('catalogo', 'cliente');
