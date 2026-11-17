#!/usr/bin/env bash
# Instalación completa de StayHub / Inversiones LR en un VPS Ubuntu 24.04 recién creado.
#
# Uso (como root o con sudo), desde tu equipo:
#   scp deploy/scripts/setup-vps.sh root@IP_DEL_VPS:/root/
#   ssh -t root@IP_DEL_VPS 'bash /root/setup-vps.sh'
#
# Pide los datos que falten. También se pueden pasar como variables de entorno
# (útil para repetir la instalación sin preguntas):
#   DOMAIN          Dominio público. Por defecto <ip-con-guiones>.sslip.io
#   ACME_EMAIL      Correo para avisos de Let's Encrypt
#   ADMIN_EMAIL     Correo del administrador inicial
#   SMTP_USER       Cuenta de Gmail que envía los correos
#   SMTP_PASS       Contraseña de aplicación de esa cuenta (16 letras)
#   SMTP_HOST / SMTP_PORT / SMTP_SECURE  Para usar otro proveedor (por defecto Gmail 465 TLS)
#   API_REPO / WEB_REPO / BRANCH         Repositorios y rama a desplegar
#
# Es idempotente: si ya existe deploy/.env no lo sobrescribe; vuelve a ejecutarlo para actualizar.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/inversiones-lr}"
API_REPO="${API_REPO:-https://github.com/Malzap12/stayhub-api.git}"
WEB_REPO="${WEB_REPO:-https://github.com/Malzap12/stayhub-web.git}"
BRANCH="${BRANCH:-main}"
DEPLOY_DIR="$APP_DIR/inversiones-lr-api/deploy"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { # ask VAR "Pregunta" [valor por defecto] [secreto]
  local var="$1" prompt="$2" def="${3:-}" secret="${4:-}" reply
  [ -n "${!var:-}" ] && return 0
  [ -r /dev/tty ] || die "Falta $var y no hay terminal para preguntarlo"
  if [ -n "$secret" ]; then
    read -r -s -p "$prompt: " reply </dev/tty; echo
  else
    read -r -p "$prompt${def:+ [$def]}: " reply </dev/tty
  fi
  reply="${reply:-$def}"
  [ -n "$reply" ] || die "$var es obligatorio"
  printf -v "$var" '%s' "$reply"
}

[ "$(id -u)" -eq 0 ] || die "Ejecuta este script como root (o con sudo)"
grep -qi ubuntu /etc/os-release || echo "Aviso: el script está probado para Ubuntu 24.04"

log "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl openssl ufw cron ca-certificates >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

# El build de Angular necesita memoria; en VPS de 1-2 GB se agrega swap.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3500 ] && ! swapon --show | grep -q .; then
  log "Creando 2 GB de swap (RAM: ${mem_mb} MB)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Firewall (SSH, 80, 443)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null

log "Código fuente en $APP_DIR (rama $BRANCH)"
mkdir -p "$APP_DIR"
for pair in "inversiones-lr-api|$API_REPO" "inversiones-lr-web|$WEB_REPO"; do
  dir="$APP_DIR/${pair%%|*}"; repo="${pair#*|}"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch -q origin "$BRANCH"
    git -C "$dir" checkout -q "$BRANCH"
    git -C "$dir" pull -q --ff-only origin "$BRANCH"
  else
    git clone -q --branch "$BRANCH" "$repo" "$dir"
  fi
  echo "  ${pair%%|*}: $(git -C "$dir" log --oneline -1)"
done

cd "$DEPLOY_DIR"
NEW_ADMIN_PASSWORD=""
if [ ! -f .env ]; then
  log "Configuración (.env)"
  public_ip=$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
  ask DOMAIN      "Dominio público" "${public_ip//./-}.sslip.io"
  ask SMTP_USER   "Cuenta de Gmail que envía los correos"
  ask SMTP_PASS   "Contraseña de aplicación de Gmail (no se muestra)" "" secret
  ask ADMIN_EMAIL "Correo del administrador inicial" "$SMTP_USER"
  ask ACME_EMAIL  "Correo para avisos de Let's Encrypt" "$SMTP_USER"
  SMTP_PASS="${SMTP_PASS// /}"   # Google la muestra en grupos de 4 con espacios

  db_password=$(openssl rand -hex 24)
  NEW_ADMIN_PASSWORD="Lr$(openssl rand -hex 6)Adm$(( RANDOM % 90 + 10 ))"

  umask 077
  cat > .env <<EOF
# Generado por setup-vps.sh el $(date -Is). No lo subas al repositorio.
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL

DATABASE_USER=lr_user
DATABASE_PASSWORD=$db_password
DATABASE_NAME=inversiones_lr_db
DATABASE_SCHEMA=stayhub

ADMIN_INITIAL_NAME=Administrador Inversiones LR
ADMIN_INITIAL_EMAIL=$ADMIN_EMAIL
ADMIN_INITIAL_PASSWORD=$NEW_ADMIN_PASSWORD

SMTP_HOST=${SMTP_HOST:-smtp.gmail.com}
SMTP_PORT=${SMTP_PORT:-465}
SMTP_SECURE=${SMTP_SECURE:-true}
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
MAIL_FROM=Inversiones LR <$SMTP_USER>

GEOCODING_USER_AGENT=StayHub/1.0 ($ACME_EMAIL)
SESSION_TIMEOUT_MINUTES=60
RATE_LIMIT_PER_MINUTE=300
ENABLE_SWAGGER=false
SEED_DEMO_DATA=false
EOF
  umask 022
  echo "  .env creado con contraseñas aleatorias (chmod 600)"
else
  log "Usando el .env existente"
fi
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2- | tr -d "\"'\r")

log "Construyendo e iniciando contenedores (la primera vez tarda varios minutos)"
chmod +x scripts/*.sh
$COMPOSE up -d --build

log "Esperando a que la API esté healthy"
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q api)" 2>/dev/null || echo starting)
  [ "$state" = healthy ] && break
  sleep 5
done
[ "$state" = healthy ] || { $COMPOSE logs --tail 80 api; die "La API no quedó healthy (estado: $state)"; }

log "Comprobando HTTPS en https://$DOMAIN"
ok=""
for _ in $(seq 1 24); do
  if curl -fsS --max-time 10 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
if [ -z "$ok" ]; then
  $COMPOSE logs --tail 40 caddy
  echo "Aviso: el certificado aún no responde. Revisa que el DNS de $DOMAIN apunte a este servidor."
fi

log "Respaldo diario (03:30)"
cron_line="30 3 * * * cd $DEPLOY_DIR && ./scripts/backup.sh >> backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF "scripts/backup.sh" || true; echo "$cron_line" ) | crontab -

$COMPOSE ps
echo
echo "StayHub está en: https://$DOMAIN"
if [ -n "$NEW_ADMIN_PASSWORD" ]; then
  echo "Administrador:   $(grep -E '^ADMIN_INITIAL_EMAIL=' .env | cut -d= -f2-)"
  echo "Contraseña:      $NEW_ADMIN_PASSWORD"
  echo "Guárdala y cámbiala desde la aplicación tras el primer ingreso."
fi
