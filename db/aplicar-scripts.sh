#!/usr/bin/env bash
# Aplica en orden los scripts SQL. Uso: DATABASE_URL=postgresql://... bash db/aplicar-scripts.sh
set -euo pipefail
URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
cd "$(dirname "$0")/scripts"
for f in *.sql; do
  echo ">> $f"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
