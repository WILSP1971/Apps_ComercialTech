-- db/scripts/000_extensiones.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- textos sin distinguir mayúsculas
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsquedas por similitud
