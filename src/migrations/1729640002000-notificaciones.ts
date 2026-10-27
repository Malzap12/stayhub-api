import { MigrationInterface, QueryRunner } from 'typeorm';

/** HU-043 · Notificaciones dentro de la plataforma (CA3): destinatario, tipo, mensaje, entidad, fecha y lectura. */
export class Notificaciones1729640002000 implements MigrationInterface {
  name = 'Notificaciones1729640002000';

  private getSchema(queryRunner: QueryRunner): string {
    const raw = (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
    return raw;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."notificaciones" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "destinatario_id" VARCHAR(100),
        "destinatario_correo" VARCHAR(255),
        "tipo" VARCHAR(50) NOT NULL,
        "mensaje" TEXT NOT NULL,
        "entidad" VARCHAR(50) NOT NULL,
        "entidad_id" VARCHAR(100) NOT NULL,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "leida" BOOLEAN NOT NULL DEFAULT FALSE,
        "leida_en" TIMESTAMPTZ,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_notificaciones_destinatario_id" ON "${s}"."notificaciones" ("destinatario_id");`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_notificaciones_destinatario_correo" ON "${s}"."notificaciones" ("destinatario_correo");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS "${s}"."notificaciones" CASCADE;`);
  }
}
