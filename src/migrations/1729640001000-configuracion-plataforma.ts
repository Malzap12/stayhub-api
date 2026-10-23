import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConfiguracionPlataforma1729640001000 implements MigrationInterface {
  name = 'ConfiguracionPlataforma1729640001000';

  private getSchema(queryRunner: QueryRunner): string {
    const raw = (queryRunner.connection.options as { schema?: string }).schema ?? 'stayhub';
    return raw;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "${s}"."configuracion_plataforma" (
        "clave" VARCHAR(100) PRIMARY KEY,
        "valor" JSONB NOT NULL,
        "actualizado_en" TIMESTAMPTZ NOT NULL,
        "actualizado_por" VARCHAR(150),
        "extra" JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.getSchema(queryRunner);
    await queryRunner.query(`DROP TABLE IF EXISTS "${s}"."configuracion_plataforma" CASCADE;`);
  }
}
