#!/usr/bin/env bash
# Restaura un respaldo creado por backup.sh. REEMPLAZA los datos actuales.
# Uso: ./scripts/restore.sh backups/db-AAAAMMDD-HHMMSS.dump [backups/uploads-AAAAMMDD-HHMMSS.tar.gz]
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose ${COMPOSE_PROJECT:+-p $COMPOSE_PROJECT} -f docker-compose.prod.yml --env-file .env"
DB_DUMP="${1:?Indica el archivo .dump a restaurar}"
UPLOADS_TAR="${2:-}"

# Lee variables de .env sin ejecutarlo (los valores pueden tener espacios, p. ej. MAIL_FROM).
env_get() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d "\"'\r"; }
DATABASE_USER="$(env_get DATABASE_USER)"
DATABASE_NAME="$(env_get DATABASE_NAME)"

read -r -p "Esto reemplazará la base ${DATABASE_NAME}. ¿Continuar? (escribe SI): " answer
[ "$answer" = "SI" ] || { echo "Cancelado."; exit 1; }

# La API guarda su estado en memoria: se detiene para que no sobrescriba lo restaurado.
$COMPOSE stop api

$COMPOSE exec -T postgres pg_restore -U "$DATABASE_USER" -d "$DATABASE_NAME" --clean --if-exists \
  < "$DB_DUMP"

if [ -n "$UPLOADS_TAR" ]; then
  $COMPOSE run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /app/uploads/* && tar -xzf - -C /app' \
    < "$UPLOADS_TAR"
fi

$COMPOSE start api
echo "Restauración completa. La API recargó los datos desde PostgreSQL."
