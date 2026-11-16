import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HU-072 · Guardar alojamientos en mis favoritos (EP-18):
 * una lista de alojamientos guardados por cuenta de huésped, ordenada de más reciente a más antigua.
 */
export class FavoritosHuesped1729640006000 implements MigrationInterface {
  name = 'FavoritosHuesped1729640006000';

  private getSchema(queryRunner: QueryRunner): string {
    return (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."favoritos_huesped" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "huesped_id" VARCHAR(255) NOT NULL,
        "huesped_correo" VARCHAR(255) NOT NULL,
        "publicacion_id" VARCHAR(100) NOT NULL,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_favoritos_huesped_pub" ON "${s}"."favoritos_huesped" ("huesped_id", "publicacion_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS "${s}"."favoritos_huesped" CASCADE;`);
  }
}
