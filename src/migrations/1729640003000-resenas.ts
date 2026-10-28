import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HU-047 · Reseñas de estancias (CA1, CA3): calificación de 1 a 5, comentario, huésped, reserva, alojamiento y
 * fecha. Una sola reseña por reserva (RN-024).
 */
export class Resenas1729640003000 implements MigrationInterface {
  name = 'Resenas1729640003000';

  private getSchema(queryRunner: QueryRunner): string {
    const raw = (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
    return raw;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."resenas" (
        "id" VARCHAR(100) PRIMARY KEY,
        "orden" INT NOT NULL DEFAULT 0,
        "reserva_id" VARCHAR(100) NOT NULL UNIQUE,
        "publicacion_id" VARCHAR(100) NOT NULL,
        "huesped_id" VARCHAR(255) NOT NULL,
        "autor" VARCHAR(255),
        "calificacion" INT NOT NULL CHECK ("calificacion" BETWEEN 1 AND 5),
        "comentario" VARCHAR(2000) NOT NULL,
        "creado_en" TIMESTAMPTZ NOT NULL,
        "visible" BOOLEAN NOT NULL DEFAULT TRUE,
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_resenas_publicacion_id" ON "${s}"."resenas" ("publicacion_id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS "${s}"."resenas" CASCADE;`);
  }
}
