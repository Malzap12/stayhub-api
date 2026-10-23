import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  createDataSourceOptions,
  getDatabaseSchema,
  isPersistenceEnabled,
} from './database.config';
import {
  computeChanges,
  normalizeDbRow,
  REGISTERED_SOURCE_TABLES,
  rowsToSource,
  sourceToRows,
  TABLE_DEFINITIONS,
} from './state-tables';

export interface PersistedSource {
  dump(): unknown;
  restore(data: unknown): void;
}

@Injectable()
export class StatePersistenceService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('StatePersistence');
  readonly enabled = isPersistenceEnabled();
  readonly schema = getDatabaseSchema();

  private dataSource?: DataSource;
  private readonly sources = new Map<string, PersistedSource>();
  // Mapa de tableName -> Map<primaryKeyString, canonicalRow>
  private readonly saved = new Map<string, Map<string, Record<string, unknown>>>();
  private flushQueue: Promise<void> = Promise.resolve();
  private periodicTimer?: NodeJS.Timeout;

  constructor() {
    // Inicializar mapas vacíos para cada tabla conocida
    for (const tableName of Object.keys(TABLE_DEFINITIONS)) {
      this.saved.set(tableName, new Map());
    }
  }

  /** Registra los datos de un servicio. Solo guarda la referencia de la fuente. */
  register(key: string, source: PersistedSource): void {
    this.sources.set(key, source);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // 1. Avisa en el log de las fuentes sin tablas configuradas
    for (const key of this.sources.keys()) {
      if (!REGISTERED_SOURCE_TABLES[key]) {
        this.logger.warn(`Fuente registrada "${key}" no tiene tablas configuradas en state-tables.ts`);
      }
    }

    // 2. Conexión con reintentos
    const retries = parseInt(process.env.DATABASE_CONNECT_RETRIES ?? '10', 10);
    const delay = parseInt(process.env.DATABASE_CONNECT_DELAY_MS ?? '1000', 10);
    await this.connectWithRetries(retries, delay);

    if (!this.dataSource?.isInitialized) {
      this.logger.error('No se pudo inicializar la conexión a PostgreSQL.');
      return;
    }

    // 3. Crear esquema y correr migraciones
    await this.dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}";`);
    const pending = await this.dataSource.showMigrations();
    if (pending) {
      const executed = await this.dataSource.runMigrations({ transaction: 'all' });
      for (const m of executed) {
        this.logger.log(`Migración aplicada: ${m.name}`);
      }
    }
    this.logger.log(`Conectado a PostgreSQL (esquema "${this.schema}")`);

    // 4. Cargar cada tabla ordenada y restaurar fuentes
    await this.loadAllTablesFromDb();
    this.restoreAllSourcesFromMemory();

    // 5. Flush inicial (en primer arranque guarda datos de ejemplo en la BD)
    await this.flush();

    // 6. Programar flush cada 30 segundos
    this.periodicTimer = setInterval(() => {
      void this.flush().catch((err) => {
        this.logger.error('Error en flush periódico a PostgreSQL', (err as Error).message);
      });
    }, 30_000);
    this.periodicTimer.unref();
  }

  private async connectWithRetries(retries: number, delayMs: number): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const ds = new DataSource(createDataSourceOptions(this.schema));
        await ds.initialize();
        this.dataSource = ds;
        return;
      } catch (error) {
        if (attempt === retries) {
          this.logger.error(
            `Fallo final conectando a PostgreSQL tras ${retries} intentos: ${(error as Error).message}`,
          );
          throw error;
        }
        this.logger.warn(
          `Intento ${attempt}/${retries} de conexión a PostgreSQL falló. Reintentando en ${delayMs}ms...`,
        );
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }

  private async loadAllTablesFromDb(): Promise<void> {
    if (!this.dataSource) return;

    for (const [tableName, def] of Object.entries(TABLE_DEFINITIONS)) {
      const orderBy = def.columns.includes('orden')
        ? '"orden" ASC'
        : def.primaryKey.map((pk) => `"${pk}" ASC`).join(', ');

      const rows: Record<string, unknown>[] = await this.dataSource.query(
        `SELECT * FROM "${this.schema}"."${tableName}" ORDER BY ${orderBy};`,
      );

      const tableMap = new Map<string, Record<string, unknown>>();
      for (const raw of rows) {
        const normalized = normalizeDbRow(tableName, raw);
        const pk = def.primaryKey.map((k) => String(normalized[k] ?? '')).join('::');
        tableMap.set(pk, normalized);
      }
      this.saved.set(tableName, tableMap);
    }
  }

  private restoreAllSourcesFromMemory(): void {
    const snapshot = this.getTablesSnapshot();
    for (const [key, source] of this.sources.entries()) {
      try {
        const data = rowsToSource(key, snapshot);
        if (data !== null) {
          source.restore(data);
        }
      } catch (err) {
        this.logger.error(`Error al restaurar fuente "${key}"`, (err as Error).stack);
      }
    }
  }

  /** Devuelve un snapshot con las filas en memoria de todas las tablas. */
  getTablesSnapshot(): Record<string, Record<string, unknown>[]> {
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const [tableName, map] of this.saved.entries()) {
      result[tableName] = Array.from(map.values());
    }
    return result;
  }

  /**
   * Encola el guardado para evitar concurrencia entre escrituras simultáneas.
   */
  async flush(): Promise<void> {
    if (!this.enabled || !this.dataSource?.isInitialized) {
      return;
    }

    const currentOp = this.flushQueue.then(() => this.executeFlush());
    this.flushQueue = currentOp.catch(() => {});
    return currentOp;
  }

  private async executeFlush(): Promise<void> {
    if (!this.dataSource?.isInitialized) {
      return;
    }

    // 1. Obtener filas actuales desde los dumps de cada fuente
    const currentTables: Record<string, Record<string, unknown>[]> = {};
    for (const tableName of Object.keys(TABLE_DEFINITIONS)) {
      currentTables[tableName] = [];
    }

    for (const [key, source] of this.sources.entries()) {
      try {
        const dump = source.dump();
        const rowsByTable = sourceToRows(key, dump);
        for (const [tbl, rows] of Object.entries(rowsByTable)) {
          if (!currentTables[tbl]) {
            currentTables[tbl] = [];
          }
          currentTables[tbl].push(...rows);
        }
      } catch (err) {
        this.logger.error(`Error al obtener volcado de "${key}"`, (err as Error).message);
      }
    }

    // 2. Calcular cambios de todas las tablas
    let hasChanges = false;
    const allChanges: Record<string, { upserts: Record<string, unknown>[]; deletes: Record<string, unknown>[]; newSaved: Map<string, Record<string, unknown>> }> = {};

    for (const [tableName, currentRows] of Object.entries(currentTables)) {
      const savedMap = this.saved.get(tableName) ?? new Map();
      const changes = computeChanges(tableName, savedMap, currentRows);
      allChanges[tableName] = changes;
      if (changes.upserts.length > 0 || changes.deletes.length > 0) {
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return;
    }

    // 3. Ejecutar transacción atómica en PostgreSQL
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query('SET CONSTRAINTS ALL DEFERRED;');

      // A. Procesar Deletes
      for (const [tableName, changes] of Object.entries(allChanges)) {
        if (changes.deletes.length === 0) continue;
        const def = TABLE_DEFINITIONS[tableName];

        for (const pkObj of changes.deletes) {
          const clauses = def.primaryKey.map((k, idx) => `"${k}" = $${idx + 1}`).join(' AND ');
          const values = def.primaryKey.map((k) => pkObj[k]);
          await queryRunner.query(
            `DELETE FROM "${this.schema}"."${tableName}" WHERE ${clauses};`,
            values,
          );
        }
      }

      // B. Procesar Upserts
      for (const [tableName, changes] of Object.entries(allChanges)) {
        if (changes.upserts.length === 0) continue;
        const def = TABLE_DEFINITIONS[tableName];

        for (const row of changes.upserts) {
          const cols: string[] = [];
          const placeholders: string[] = [];
          const values: unknown[] = [];
          const updates: string[] = [];

          let paramIndex = 1;
          for (const col of def.columns) {
            let val = row[col];
            cols.push(`"${col}"`);

            if (def.jsonbColumns?.includes(col)) {
              placeholders.push(`$${paramIndex}::jsonb`);
              values.push(JSON.stringify(val ?? {}));
            } else {
              placeholders.push(`$${paramIndex}`);
              values.push(val === undefined ? null : val);
            }

            if (!def.primaryKey.includes(col)) {
              if (def.jsonbColumns?.includes(col)) {
                updates.push(`"${col}" = EXCLUDED."${col}"::jsonb`);
              } else {
                updates.push(`"${col}" = EXCLUDED."${col}"`);
              }
            }
            paramIndex++;
          }

          const conflictTarget = def.primaryKey.map((k) => `"${k}"`).join(', ');
          const updateClause = updates.length > 0
            ? `DO UPDATE SET ${updates.join(', ')}`
            : 'DO NOTHING';

          const sql = `
            INSERT INTO "${this.schema}"."${tableName}" (${cols.join(', ')})
            VALUES (${placeholders.join(', ')})
            ON CONFLICT (${conflictTarget}) ${updateClause};
          `;

          await queryRunner.query(sql, values);
        }
      }

      await queryRunner.commitTransaction();

      // Solo al confirmar, actualizar "saved" en memoria
      for (const [tableName, changes] of Object.entries(allChanges)) {
        this.saved.set(tableName, changes.newSaved);
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Error en transacción de persistencia en PostgreSQL: ${(error as Error).message}`,
        (error as Error).stack,
      );
      this.resync();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Restaura el estado de cada servicio desde la última versión confirmada en memoria,
   * sin consultar la base de datos (funciona incluso si PostgreSQL está caído).
   */
  resync(): void {
    this.restoreAllSourcesFromMemory();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
    }
    try {
      await this.flush();
    } catch (err) {
      this.logger.error('Error al realizar flush final en shutdown', (err as Error).message);
    }

    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
      this.logger.log('Conexión con PostgreSQL cerrada correctamente');
    }
  }
}
