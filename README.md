# StayHub API — Inversiones LR

API REST del marketplace de alojamientos **StayHub (Inversiones LR)**, construida con NestJS 10 y PostgreSQL 16.

El frontend vive en el repositorio [stayhub-web](https://github.com/Malzap12/stayhub-web).

## Contenido

- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Ejecución local](#ejecución-local)
- [Variables de entorno](#variables-de-entorno)
- [Pruebas](#pruebas)
- [Documentación de la API](#documentación-de-la-api)
- [Despliegue](#despliegue)
- [Flujo de trabajo](#flujo-de-trabajo)

## Arquitectura

```
src/
├── main.ts                 Arranque: prefijo /api, helmet, CORS, validación, Swagger
├── app.module.ts           Módulos, guard de roles, rate limiting, logging e interceptores
├── health.controller.ts    GET /api/health
├── config/                 Validación de variables de entorno (env.validation.ts)
├── common/                 Decoradores, guards, filtros, interceptores, pipes y enums
├── migrations/             Migraciones TypeORM del esquema "stayhub"
└── modules/
    ├── auth/               Registro, login, sesiones, recuperación de contraseña
    ├── users/              Perfil y desactivación de cuenta
    ├── listings/           Publicaciones, imágenes, disponibilidad, mapa, moderación
    ├── bookings/           Cotización, reservas, cancelaciones, reembolsos, reseñas
    ├── payments/           Pagos en modo sandbox
    ├── reviews/            Reseñas de alojamientos
    ├── reports/            Indicadores y exportación (PDF / Excel)
    ├── audit/              Bitácora de auditoría (solo inserción)
    ├── notifications/      Notificaciones a huéspedes y anfitriones
    ├── messages/           Conversaciones entre usuarios
    ├── favorites/          Alojamientos favoritos
    ├── platform/           Configuración de la plataforma (comisiones)
    ├── mail/               Envío de correos por SMTP
    └── persistence/        Persistencia del estado en PostgreSQL
```

**Persistencia.** Cada servicio mantiene sus datos en memoria y `StatePersistenceService` los guarda en PostgreSQL:

- después de cada `POST`, `PUT`, `PATCH` o `DELETE`;
- cada 30 segundos;
- al apagar la API.

Al arrancar, la API aplica las migraciones y recarga todo desde la base. En consecuencia, **la API debe ejecutarse como una sola instancia**: con varias réplicas, los datos divergen.

**Autenticación.** El login devuelve un token opaco (`Authorization: Bearer <token>`) con la sesión guardada en el servidor. El `RolesGuard` global aplica `@Roles(...)` y `@Public()`. Los roles son `HUESPED`, `ANFITRION` y `ADMINISTRADOR`.

El administrador inicial se crea en el primer arranque a partir de `ADMIN_INITIAL_*`.

## Requisitos

- Node.js 22 LTS y npm 10 o superior
- PostgreSQL 16 (local o en Docker)
- Docker y Docker Compose (opcional, para levantar todo el stack)

## Ejecución local

### Opción A — Stack completo con Docker (recomendado)

Clona los repositorios uno al lado del otro:

```bash
git clone https://github.com/Malzap12/stayhub-api.git inversiones-lr-api
git clone https://github.com/Malzap12/stayhub-web.git inversiones-lr-web
cd inversiones-lr-api/deploy
docker compose up -d --build
```

| Servicio | URL |
|---|---|
| Web | http://localhost:4200 |
| API | http://localhost:3000/api |
| Swagger | http://localhost:3000/api/docs |
| Correos de prueba (Mailpit) | http://localhost:8025 |

Credenciales de desarrollo del administrador: `admin@inversioneslr.com` / `AdminLr2026!`. Solo valen en desarrollo: en producción la API las rechaza.

### Opción B — API con Node y PostgreSQL en Docker

```bash
npm ci
cp .env.example .env

# PostgreSQL de desarrollo
docker run -d --name stayhub-db -p 5432:5432 \
  -e POSTGRES_USER=lr_user -e POSTGRES_PASSWORD=lr_password123 -e POSTGRES_DB=inversiones_lr_db \
  postgres:16-alpine

npm run start:dev        # http://localhost:3000/api con recarga automática
```

Sin `SMTP_HOST`, la recuperación de contraseña usa un buzón simulado. Está disponible en `GET /api/auth/password-recovery/mailbox?email=...`, solo fuera de producción.

### Scripts

| Script | Descripción |
|---|---|
| `npm run start:dev` | Desarrollo con recarga automática |
| `npm run build` | Compila a `dist/` |
| `npm run start:prod` | Ejecuta `dist/main.js` |
| `npm test` | Pruebas unitarias e integración (Jest) |
| `npm run test:cov` | Pruebas con cobertura (`coverage/lcov.info`) |
| `npm run test:e2e` | Pruebas de contrato (`test/`) |
| `npm run openapi:generate` | Regenera `docs/openapi.json` |

## Variables de entorno

La lista completa y comentada está en [`.env.example`](.env.example). Las principales:

| Variable | Descripción |
|---|---|
| `NODE_ENV` | `development` o `production`. En producción se validan las variables al arrancar |
| `PORT` | Puerto HTTP (por defecto 3000) |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | Conexión a PostgreSQL |
| `DATABASE_SCHEMA` | Esquema de la aplicación (por defecto `stayhub`) |
| `DATABASE_SSL` | `true` para bases administradas con TLS |
| `CORS_ORIGINS` | Orígenes permitidos, separados por comas |
| `APP_BASE_URL` | URL pública del frontend (enlaces en los correos) |
| `ADMIN_INITIAL_NAME`, `ADMIN_INITIAL_EMAIL`, `ADMIN_INITIAL_PASSWORD` | Administrador creado en el primer arranque |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Correo saliente |
| `SESSION_TIMEOUT_MINUTES` | Duración de la sesión (por defecto 60) |
| `RATE_LIMIT_PER_MINUTE` | Peticiones por minuto por IP (login: 10/min, recuperación: 20/min) |
| `ENABLE_SWAGGER` | Swagger en `/api/docs` (por defecto solo fuera de producción) |
| `SEED_DEMO_DATA` | Publicaciones de ejemplo (por defecto solo fuera de producción) |
| `UPLOADS_DIR` | Carpeta de imágenes subidas |
| `PAYMENT_MODE` | Siempre `test`: los pagos son simulados |

Con `NODE_ENV=production`, la API **no arranca** en estos casos:

- falta `SMTP_HOST`, `APP_BASE_URL` (debe usar https) o `CORS_ORIGINS`;
- se usan las contraseñas de ejemplo de `.env.example`;
- `PERSIST_STATE=false`.

## Pruebas

```bash
npm test                 # unitarias
npm run test:cov         # con cobertura, como en la CI
```

Las pruebas de integración con PostgreSQL (`*.integration.spec.ts`) se ejecutan cuando existen las variables `TEST_DATABASE_HOST`, `TEST_DATABASE_PORT`, `TEST_DATABASE_USER`, `TEST_DATABASE_PASSWORD` y `TEST_DATABASE_NAME`. Si no están definidas, se omiten.

La CI de GitHub Actions (`.github/workflows/ci.yml`) ejecuta estos pasos en cada push y PR a `main`:

1. `npm ci`
2. build
3. pruebas con cobertura contra un PostgreSQL de servicio
4. build de la imagen Docker
5. análisis de SonarCloud

## Documentación de la API

- **Swagger UI:** `http://localhost:3000/api/docs`, en desarrollo.
- **OpenAPI:** [`docs/openapi.json`](docs/openapi.json).
- **Postman:** colección y entorno local en [`docs/postman/`](docs/postman/).
- **Salud:** `GET /api/health` responde `{"status":"ok"}` si PostgreSQL responde, o 503 si no.

## Despliegue

La configuración de producción está en [`deploy/`](deploy/). Incluye:

- Docker Compose con Caddy (HTTPS automático), web, API y PostgreSQL;
- scripts de respaldo y restauración;
- el manual paso a paso para un VPS.

Consulta [`deploy/README.md`](deploy/README.md).

## Flujo de trabajo

- No se hace push directo a `main`. Cada cambio va en una rama `feature/HU-XXX-...`, `feature/TA-XX-...` o `fix/...` con un Pull Request.
- Los commits siguen Conventional Commits con el ID de Jira, por ejemplo `feat(HU-012): ... (CA1)`.
- El merge requiere la CI en verde, el Quality Gate de SonarCloud aprobado y la revisión de un compañero.
