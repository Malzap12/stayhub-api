#!/usr/bin/env bash
# Respaldo diario de PostgreSQL y de las imágenes subidas, con rotación.
# Cron sugerido (03:30 todos los días):
#   30 3 * * * cd /opt/inversiones-lr/inversiones-lr-api/deploy && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose ${COMPOSE_PROJECT:+-p $COMPOSE_PROJECT} -f docker-compose.prod.yml --env-file .env"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Lee variables de .env sin ejecutarlo (los valores pueden tener espacios, p. ej. MAIL_FROM).
env_get() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d "\"'\r"; }
DATABASE_USER="$(env_get DATABASE_USER)"
DATABASE_NAME="$(env_get DATABASE_NAME)"
mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Respaldando base de datos ${DATABASE_NAME}..."
$COMPOSE exec -T postgres pg_dump -U "$DATABASE_USER" -d "$DATABASE_NAME" --format=custom \
  > "$BACKUP_DIR/db-$STAMP.dump"

echo "[$(date -Is)] Respaldando imágenes subidas..."
$COMPOSE exec -T api tar -czf - -C /app uploads > "$BACKUP_DIR/uploads-$STAMP.tar.gz"

find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date -Is)] Listo: $BACKUP_DIR/db-$STAMP.dump y $BACKUP_DIR/uploads-$STAMP.tar.gz"
# Recomendado: copiar $BACKUP_DIR fuera del VPS (rclone, scp, almacenamiento S3...).
