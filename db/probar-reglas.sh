#!/usr/bin/env bash
# Verifica las reglas de negocio a nivel de base de datos (R3, R5, R8, R9, R10).
set -euo pipefail
URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
psql "$URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/tests/reglas.sql"
