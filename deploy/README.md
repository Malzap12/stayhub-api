# Despliegue — StayHub / Inversiones LR

Configuración para desplegar **StayHub / Inversiones LR** con Docker Compose. Vive en la carpeta `deploy/` del repositorio de la API y construye también el repositorio web, que debe estar clonado al lado (`../../inversiones-lr-web`).

| Archivo | Para qué |
|---|---|
| `docker-compose.prod.yml` | Producción en un VPS: Caddy (HTTPS automático) → web → api → postgres |
| `docker-compose.yml` | Desarrollo local, con mailpit como buzón de pruebas |
| `Caddyfile` | Proxy HTTPS con certificados de Let's Encrypt |
| `.env.example` | Variables de producción (cópialo como `.env`) |
| `scripts/backup.sh` / `scripts/restore.sh` | Respaldo y restauración de la base de datos y las imágenes |

```
Internet ──443──▶ caddy ──▶ web (nginx + Angular) ──/api/──▶ api (NestJS) ──▶ postgres
                                                              └─ volumen api_uploads (imágenes)
```

## Reglas importantes

- **Una sola instancia de la API.** La API mantiene el estado en memoria y lo guarda en PostgreSQL después de cada escritura y cada 30 s. Con dos réplicas los datos divergen y se sobrescriben entre sí. No uses `--scale api=2` ni orquestadores con varias réplicas.
- **El esquema de base de datos lo crean las migraciones de la API** en el esquema `stayhub`, al arrancar. Los scripts SQL de `BaseDeDatos-IngSoft1` no se usan en el despliegue.
- **`NODE_ENV=production` es estricto.** La API no arranca si falta SMTP, `APP_BASE_URL` o `CORS_ORIGINS`, ni si se usan las contraseñas de ejemplo. El buzón simulado de recuperación de contraseña queda desactivado.

## Instalación rápida (script)

`scripts/setup-vps.sh` hace en un solo paso las secciones 1 a 3 y el respaldo diario:

- instala Docker y el firewall, y agrega swap si hay poca RAM;
- clona los repositorios;
- genera el `.env` con contraseñas aleatorias, preguntando el dominio y la cuenta SMTP;
- levanta el stack y verifica `/api/health` por HTTPS.

Por defecto usa Gmail SMTP con una contraseña de aplicación. Si no tienes dominio, propone `<ip-con-guiones>.sslip.io`.

```bash
scp deploy/scripts/setup-vps.sh root@IP_DEL_VPS:/root/
ssh -t root@IP_DEL_VPS 'bash /root/setup-vps.sh'
```

Al terminar, el script muestra la URL y la contraseña del administrador, que solo se muestra esa vez. Puedes volver a ejecutarlo para actualizar: si ya existe un `.env`, lo conserva.

## 1. Preparar el VPS (Ubuntu 24.04, mínimo 2 GB RAM)

```bash
# Docker Engine + plugin compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # cierra y vuelve a abrir la sesión

# Firewall: solo SSH y web
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443
sudo ufw enable
```

> Docker publica puertos saltándose UFW. Por eso `docker-compose.prod.yml` solo publica los puertos 80 y 443 de Caddy. PostgreSQL y la API no se publican.

**DNS:** crea un registro `A` de tu dominio (por ejemplo `stayhub.tu-dominio.com`) apuntando a la IP del VPS antes del primer arranque. Caddy lo necesita para emitir el certificado.

## 2. Clonar los repositorios (uno al lado del otro)

```bash
sudo mkdir -p /opt/inversiones-lr && sudo chown $USER /opt/inversiones-lr
cd /opt/inversiones-lr
git clone https://github.com/Malzap12/stayhub-api.git inversiones-lr-api
git clone https://github.com/Malzap12/stayhub-web.git inversiones-lr-web
```

## 3. Configurar y arrancar

```bash
cd /opt/inversiones-lr/inversiones-lr-api/deploy
cp .env.example .env
chmod 600 .env
nano .env            # dominio, contraseñas (openssl rand -base64 32), SMTP...

docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps        # api debe aparecer "healthy"
docker compose -f docker-compose.prod.yml logs -f api
```

Comprobación rápida:

```bash
curl -fsS https://$DOMINIO/api/health              # {"status":"ok"}
```

Después del primer ingreso, cambia la contraseña del administrador desde la aplicación. `ADMIN_INITIAL_PASSWORD` solo se usa si todavía no existe ningún administrador.

## 4. Actualizar a una nueva versión

```bash
cd /opt/inversiones-lr
git -C inversiones-lr-api pull
git -C inversiones-lr-web pull
cd inversiones-lr-api/deploy
./scripts/backup.sh                                  # respaldo antes de actualizar
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Compose detiene el contenedor viejo de la API antes de iniciar el nuevo. La API guarda su estado al apagarse (`stop_grace_period: 30s`) y aplica las migraciones nuevas al arrancar. Hay unos segundos de corte durante el reinicio.

## 5. Respaldos

```bash
chmod +x scripts/*.sh
./scripts/backup.sh                                  # crea backups/db-*.dump y backups/uploads-*.tar.gz
crontab -e
# 30 3 * * * cd /opt/inversiones-lr/inversiones-lr-api/deploy && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Copia la carpeta `backups/` fuera del VPS con regularidad (rclone, scp o almacenamiento S3).

Para restaurar (detiene la API, reemplaza la base de datos y vuelve a iniciarla):

```bash
./scripts/restore.sh backups/db-AAAAMMDD-HHMMSS.dump backups/uploads-AAAAMMDD-HHMMSS.tar.gz
```

## Desarrollo local

```bash
docker compose up -d --build
# Web http://localhost:4200 · API http://localhost:3000/api/docs · Correos http://localhost:8025
```

## Servicios externos

- **Mapa:** usa los tiles públicos de OpenStreetMap y la geocodificación de Nominatim (1 petición/s). Sirven para tráfico bajo. Si el tráfico crece, conviene pasar a un proveedor con licencia (MapTiler, Stadia, LocationIQ). Define `GEOCODING_USER_AGENT` con un contacto real.
- **Pagos:** la API solo opera en modo sandbox (`PAYMENT_MODE=test`). No procesa dinero real.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `api` se reinicia con "Configuración de entorno inválida" | Falta una variable obligatoria o hay una contraseña de ejemplo en `.env` |
| Caddy no obtiene el certificado | El DNS aún no apunta al VPS, o los puertos 80/443 están bloqueados por el proveedor |
| `web` no arranca | La API no está `healthy` (revisa `logs api`, por ejemplo la conexión a PostgreSQL) |
| No llegan los correos de recuperación | Credenciales SMTP incorrectas: busca `No se pudo enviar el correo` en `logs api` |
