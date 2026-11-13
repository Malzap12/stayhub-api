import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HU-070 · Conversar por mensajes entre huésped y anfitrión (EP-18):
 * una conversación única por (publicacion_id, huesped_id) y sus mensajes de texto plano (máx. 1000 caracteres).
 */
export class ConversacionesMensajes1729640005000 implements MigrationInterface {
  name = 'ConversacionesMensajes1729640005000';

  private getSchema(queryRunner: QueryRunner): string {
    return (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."conversaciones" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "publicacion_id" VARCHAR(100) NOT NULL,
        "publicacion_titulo" VARCHAR(255) NOT NULL,
        "huesped_id" VARCHAR(255) NOT NULL,
        "huesped_correo" VARCHAR(255) NOT NULL,
        "huesped_nombre" VARCHAR(255) NOT NULL,
        "anfitrion_id" VARCHAR(255) NOT NULL,
        "anfitrion_correo" VARCHAR(255),
        "anfitrion_nombre" VARCHAR(255) NOT NULL,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "actualizado_en" TIMESTAMPTZ NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversaciones_pub_huesped" ON "${s}"."conversaciones" ("publicacion_id", "huesped_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."mensajes" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "conversacion_id" VARCHAR(100) NOT NULL,
        "remitente_id" VARCHAR(255) NOT NULL,
        "remitente_rol" VARCHAR(40) NOT NULL,
        "remitente_nombre" VARCHAR(255) NOT NULL,
        "contenido" VARCHAR(1000) NOT NULL,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "leido_en" TIMESTAMPTZ,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_mensajes_conversacion_id" ON "${s}"."mensajes" ("conversacion_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS "${s}"."mensajes" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "${s}"."conversaciones" CASCADE;`);
  }
}
