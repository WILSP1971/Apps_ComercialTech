#!/usr/bin/env bash
# infra/scripts/backup.sh   (cron: 0 2 * * *  /home/deploy/plataforma/app/infra/scripts/backup.sh)
set -euo pipefail
DESTINO=/home/deploy/backups
FECHA=$(date +%F_%H%M)
mkdir -p "$DESTINO"
docker exec supabase-db pg_dump -U postgres -d postgres -Fc --exclude-schema=realtime > "$DESTINO/bd_$FECHA.dump"
find "$DESTINO" -name 'bd_*.dump' -mtime +14 -delete          # retención 14 días
# Copia externa (ejemplo con rclone configurado hacia un almacenamiento de objetos):
# rclone copy "$DESTINO/bd_$FECHA.dump" remoto:sierrainnova-backups/
