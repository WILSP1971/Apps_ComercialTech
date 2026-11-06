-- db/scripts/005_seguridad.sql
CREATE TABLE seguridad.empresa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit           text NOT NULL UNIQUE,
  razon_social  text NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

-- id = auth.users.id de Supabase Auth (claim "sub" del JWT)
CREATE TABLE seguridad.usuario (
  id         uuid PRIMARY KEY,
  nombre     text NOT NULL,
  correo     citext NOT NULL UNIQUE,
  activo     boolean NOT NULL DEFAULT true,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seguridad.rol (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  text NOT NULL UNIQUE,
  nombre  text NOT NULL
);

CREATE TABLE seguridad.permiso (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  text NOT NULL UNIQUE           -- 'pedidos.pedido.aprobar'
);

CREATE TABLE seguridad.rol_permiso (
  rol_id      uuid NOT NULL REFERENCES seguridad.rol(id),
  permiso_id  uuid NOT NULL REFERENCES seguridad.permiso(id),
  PRIMARY KEY (rol_id, permiso_id)
);

-- Un usuario puede tener VARIOS roles en una empresa (vendedor + cajero).
-- cliente_id solo se usa para el rol 'cliente_web' (referencia lógica a catalogo.cliente).
CREATE TABLE seguridad.usuario_empresa (
  usuario_id  uuid NOT NULL REFERENCES seguridad.usuario(id),
  empresa_id  uuid NOT NULL REFERENCES seguridad.empresa(id),
  rol_id      uuid NOT NULL REFERENCES seguridad.rol(id),
  cliente_id  uuid,
  activo      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (usuario_id, empresa_id, rol_id)
);
