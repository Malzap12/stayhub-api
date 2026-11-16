import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HU-069 · Ubicación del alojamiento en mapa (CA1, CA6):
 * agrega las columnas `latitud` y `longitud` (nullable) a `publicaciones`
 * y la restricción de rango válido (-90..90 y -180..180, ambas o ninguna).
 */
export class UbicacionMapaAlojamiento1729640004000 implements MigrationInterface {
  name = 'UbicacionMapaAlojamiento1729640004000';

  private getSchema(queryRunner: QueryRunner): string {
    return (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`
      ALTER TABLE "${s}"."publicaciones"
        ADD COLUMN IF NOT EXISTS "latitud" DECIMAL(9,6) NULL,
        ADD COLUMN IF NOT EXISTS "longitud" DECIMAL(9,6) NULL;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'CK_publicaciones_coordenadas_rango'
        ) THEN
          ALTER TABLE "${s}"."publicaciones"
            ADD CONSTRAINT "CK_publicaciones_coordenadas_rango"
            CHECK (
              ("latitud" IS NULL AND "longitud" IS NULL) OR
              ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180)
            );
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`
      ALTER TABLE "${s}"."publicaciones"
        DROP CONSTRAINT IF EXISTS "CK_publicaciones_coordenadas_rango",
        DROP COLUMN IF EXISTS "latitud",
        DROP COLUMN IF EXISTS "longitud";
    `);
  }
}
