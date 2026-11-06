#!/usr/bin/env bash
# infra/scripts/deploy.sh
set -euo pipefail
cd ~/plataforma/app
git pull --ff-only

# Migraciones: aplica solo los scripts que aún no están registrados en nucleo.migracion
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1"
$PSQL -q -c "CREATE SCHEMA IF NOT EXISTS nucleo; CREATE TABLE IF NOT EXISTS nucleo.migracion (archivo text PRIMARY KEY, aplicada_en timestamptz DEFAULT now());"
for f in db/scripts/*.sql; do
  nombre=$(basename "$f")
  existe=$($PSQL -Atc "SELECT 1 FROM nucleo.migracion WHERE archivo='$nombre'")
  if [ -z "$existe" ]; then
    echo ">> Aplicando $nombre"
    $PSQL < "$f"
    $PSQL -q -c "INSERT INTO nucleo.migracion(archivo) VALUES ('$nombre')"
  fi
done

cd infra
docker compose --env-file .env.web up -d --build
docker image prune -f
