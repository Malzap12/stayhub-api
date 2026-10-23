import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrearEsquemaStayhub1729640000000 implements MigrationInterface {
  name = 'CrearEsquemaStayhub1729640000000';

  private getSchema(queryRunner: QueryRunner): string {
    const raw = (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
    return raw;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${s}";`);

    // 1. Usuarios
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."usuarios" (
        "id" VARCHAR(100) PRIMARY KEY,
        "nombre" VARCHAR(150) NOT NULL,
        "correo" VARCHAR(150) UNIQUE NOT NULL,
        "telefono" VARCHAR(50),
        "contrasena_hash" VARCHAR(255) NOT NULL,
        "rol" VARCHAR(50) NOT NULL,
        "estado" VARCHAR(50) NOT NULL,
        "motivo_restriccion" TEXT,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // 2. Sesiones
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."sesiones" (
        "token" VARCHAR(255) PRIMARY KEY,
        "usuario_id" VARCHAR(100) NOT NULL REFERENCES "${s}"."usuarios"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        "correo" VARCHAR(150) NOT NULL,
        "rol" VARCHAR(50) NOT NULL,
        "expira_en" BIGINT NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // 3. Eventos de Auditoría (bitácora inmutable de solo inserción)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."eventos_auditoria" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "actor" VARCHAR(150) NOT NULL,
        "accion" VARCHAR(100) NOT NULL,
        "entidad" VARCHAR(100) NOT NULL,
        "entidad_id" VARCHAR(100),
        "ocurrido_en" TIMESTAMPTZ NOT NULL,
        "resultado" VARCHAR(50) NOT NULL,
        "detalle" TEXT,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE OR REPLACE FUNCTION "${s}".trg_proteger_auditoria_fn()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Los eventos de auditoría son inmutables (solo inserción)';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_proteger_auditoria ON "${s}"."eventos_auditoria";
      CREATE TRIGGER trg_proteger_auditoria
      BEFORE UPDATE OR DELETE ON "${s}"."eventos_auditoria"
      FOR EACH ROW EXECUTE FUNCTION "${s}".trg_proteger_auditoria_fn();
    `);

    // 4. Tokens de recuperación
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."tokens_recuperacion" (
        "hash" VARCHAR(255) PRIMARY KEY,
        "correo" VARCHAR(150) NOT NULL,
        "expira_en" BIGINT NOT NULL,
        "usado" BOOLEAN NOT NULL DEFAULT FALSE,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // 5. Correos simulados
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."correos_simulados" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "para" VARCHAR(150) NOT NULL,
        "asunto" VARCHAR(255) NOT NULL,
        "cuerpo" TEXT NOT NULL,
        "token" VARCHAR(255),
        "expira_en" BIGINT,
        "enviado_en" TIMESTAMPTZ NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // 6. Solicitudes de recuperación
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."solicitudes_recuperacion" (
        "correo" VARCHAR(150) PRIMARY KEY,
        "intentos" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    // 7. Publicaciones (solo titulo es NOT NULL para admitir borradores incompletos HU-010)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."publicaciones" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "titulo" VARCHAR(255) NOT NULL,
        "descripcion" TEXT,
        "ciudad" VARCHAR(100),
        "departamento" VARCHAR(100),
        "direccion" VARCHAR(255),
        "pais" VARCHAR(100),
        "tipo" VARCHAR(50),
        "precio_noche" DOUBLE PRECISION,
        "tarifa_limpieza" DOUBLE PRECISION,
        "descuento_estancia" JSONB,
        "capacidad" INT,
        "habitaciones" INT,
        "banos" INT,
        "servicios" TEXT[],
        "reglas" TEXT[],
        "imagenes" TEXT[],
        "completa" BOOLEAN,
        "campos_faltantes" TEXT[],
        "calificacion" DOUBLE PRECISION,
        "total_resenas" INT,
        "anfitrion_id" VARCHAR(100),
        "anfitrion_nombre" VARCHAR(150),
        "estado" VARCHAR(50),
        "solicitada_en" TIMESTAMPTZ,
        "motivo_devolucion" TEXT,
        "motivo_bloqueo" TEXT,
        "politica_cancelacion" VARCHAR(50),
        "servicios_adicionales" JSONB,
        "creado_en" TIMESTAMPTZ,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE INDEX IF NOT EXISTS "idx_publicaciones_anfitrion" ON "${s}"."publicaciones" ("anfitrion_id");
      CREATE INDEX IF NOT EXISTS "idx_publicaciones_estado" ON "${s}"."publicaciones" ("estado");
    `);

    // 8. Notificaciones de anfitrión
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."notificaciones_anfitrion" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "publicacion_id" VARCHAR(100) REFERENCES "${s}"."publicaciones"("id") ON DELETE CASCADE,
        "anfitrion_id" VARCHAR(100) NOT NULL,
        "tipo" VARCHAR(50) NOT NULL,
        "mensaje" TEXT NOT NULL,
        "motivo" TEXT,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE INDEX IF NOT EXISTS "idx_notif_publicacion" ON "${s}"."notificaciones_anfitrion" ("publicacion_id");
    `);

    // 9. Periodos disponibles
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."periodos_disponibles" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "publicacion_id" VARCHAR(100) NOT NULL REFERENCES "${s}"."publicaciones"("id") ON DELETE CASCADE,
        "fecha_inicio" DATE NOT NULL,
        "fecha_fin" DATE NOT NULL,
        "disponible" BOOLEAN NOT NULL DEFAULT TRUE,
        "creado_en" TIMESTAMPTZ,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "chk_periodos_disponibles_fechas" CHECK ("fecha_fin" > "fecha_inicio")
      );

      CREATE INDEX IF NOT EXISTS "idx_periodos_disp_publicacion" ON "${s}"."periodos_disponibles" ("publicacion_id");
    `);

    // 10. Periodos reservados
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."periodos_reservados" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "publicacion_id" VARCHAR(100) NOT NULL REFERENCES "${s}"."publicaciones"("id") ON DELETE CASCADE,
        "reserva_id" VARCHAR(100),
        "tipo" VARCHAR(50) NOT NULL DEFAULT 'RESERVA',
        "fecha_llegada" DATE NOT NULL,
        "fecha_salida" DATE NOT NULL,
        "noches" TEXT[] NOT NULL DEFAULT '{}',
        "creado_en" TIMESTAMPTZ,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "chk_periodos_reservados_fechas" CHECK ("fecha_salida" > "fecha_llegada")
      );

      CREATE INDEX IF NOT EXISTS "idx_periodos_res_publicacion" ON "${s}"."periodos_reservados" ("publicacion_id");
    `);

    // 11. Huéspedes con reserva
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."huespedes_con_reserva" (
        "publicacion_id" VARCHAR(100) NOT NULL REFERENCES "${s}"."publicaciones"("id") ON DELETE CASCADE,
        "usuario_id" VARCHAR(100) NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY ("publicacion_id", "usuario_id")
      );
    `);

    // 12. Reservas (llegada y salida en TEXT para preservar formato/hora)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."reservas" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "publicacion_id" VARCHAR(100) NOT NULL,
        "huesped_id" VARCHAR(100) NOT NULL,
        "fecha_llegada" TEXT NOT NULL,
        "fecha_salida" TEXT NOT NULL,
        "huespedes" INT NOT NULL,
        "tarifa_servicio" DOUBLE PRECISION,
        "total" DOUBLE PRECISION NOT NULL,
        "moneda" VARCHAR(10) NOT NULL,
        "estado" VARCHAR(50) NOT NULL,
        "clave_idempotencia" VARCHAR(150),
        "peticiones_especiales" TEXT,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE;`);
  }
}
