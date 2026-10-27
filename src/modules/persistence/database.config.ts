import { DataSource, DataSourceOptions } from 'typeorm';
import { types } from 'pg';
import { CrearEsquemaStayhub1729640000000 } from '../../migrations/1729640000000-crear-esquema-stayhub';
import { ConfiguracionPlataforma1729640001000 } from '../../migrations/1729640001000-configuracion-plataforma';
import { Notificaciones1729640002000 } from '../../migrations/1729640002000-notificaciones';

// Parser para DATE (OID 1082) -> string 'AAAA-MM-DD'
types.setTypeParser(1082, (val: string) => val);
// Parser para BIGINT (OID 20) -> number
types.setTypeParser(20, (val: string) => Number.parseInt(val, 10));

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** Valida que el nombre de esquema sea un identificador seguro para PostgreSQL. */
export function validateSchemaName(schema: string): string {
  const trimmed = schema?.trim().toLowerCase();
  if (!trimmed || !SCHEMA_PATTERN.test(trimmed)) {
    throw new Error(
      `Esquema de base de datos inválido: "${schema}". Debe ser minúsculas y cumplir /^[a-z_][a-z0-9_]*$/`,
    );
  }
  return trimmed;
}

export function isPersistenceEnabled(): boolean {
  return process.env.PERSIST_STATE !== 'false' && process.env.NODE_ENV !== 'test';
}

export function getDatabaseSchema(): string {
  const raw = process.env.DATABASE_SCHEMA ?? 'stayhub';
  return validateSchemaName(raw);
}

export function createDataSourceOptions(customSchema?: string): DataSourceOptions {
  const schema = customSchema ? validateSchemaName(customSchema) : getDatabaseSchema();
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;

  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number.parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    username: process.env.DATABASE_USER ?? 'lr_user',
    password: process.env.DATABASE_PASSWORD ?? 'lr_password123',
    database: process.env.DATABASE_NAME ?? 'inversiones_lr_db',
    schema,
    ssl,
    synchronize: false,
    migrationsTableName: 'migraciones',
    migrations: [CrearEsquemaStayhub1729640000000, ConfiguracionPlataforma1729640001000, Notificaciones1729640002000],
  };
}

export const AppDataSource = new DataSource(createDataSourceOptions());
