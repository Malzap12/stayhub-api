import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Datos en memoria de un servicio que se guardan en disco y se recuperan al iniciar. */
export interface PersistedSource {
  dump(): unknown;
  restore(data: unknown): void;
}

const DATE_TAG = '$date';

/** JSON que conserva las fechas como Date al volver a leerlo. */
export function serializeState(state: Record<string, unknown>): string {
  return JSON.stringify(
    state,
    function replacer(this: Record<string, unknown>, key: string, value: unknown) {
      const raw = this[key];
      return raw instanceof Date ? { [DATE_TAG]: raw.toISOString() } : value;
    },
    2,
  );
}

export function deserializeState(text: string): Record<string, unknown> {
  return JSON.parse(text, (_key, value) =>
    value && typeof value === 'object' && typeof value[DATE_TAG] === 'string' && Object.keys(value).length === 1
      ? new Date(value[DATE_TAG])
      : value,
  );
}

/**
 * Persistencia del estado del API en un archivo JSON (DATA_FILE), para que los datos ingresados
 * no se pierdan al reiniciar o reconstruir los contenedores. Cada servicio registra sus datos;
 * si el archivo ya los tenía, se restauran en ese momento. Se guarda tras cada operación que
 * modifica datos (PersistStateInterceptor), cada 30 s y al apagar el API.
 * En las pruebas (NODE_ENV=test) o con PERSIST_STATE=false no lee ni escribe el disco.
 */
@Injectable()
export class StatePersistenceService implements OnApplicationShutdown {
  private readonly logger = new Logger('StatePersistence');
  readonly filePath = process.env.DATA_FILE ?? join(process.cwd(), 'data', 'estado.json');
  readonly enabled = process.env.PERSIST_STATE !== 'false' && process.env.NODE_ENV !== 'test';
  private readonly sources = new Map<string, PersistedSource>();
  private readonly saved: Record<string, unknown>;
  private pendingSave?: NodeJS.Timeout;
  private readonly periodicSave?: NodeJS.Timeout;

  constructor() {
    this.saved = this.enabled ? this.readFile() : {};
    if (this.enabled) {
      this.periodicSave = setInterval(() => this.save(), 30_000);
      this.periodicSave.unref();
    }
  }

  private readFile(): Record<string, unknown> {
    if (!existsSync(this.filePath)) {
      return {};
    }
    try {
      const state = deserializeState(readFileSync(this.filePath, 'utf-8'));
      this.logger.log(`Datos recuperados de ${this.filePath}`);
      return state;
    } catch (error) {
      this.logger.error(`No se pudo leer ${this.filePath}; se inicia con los datos de ejemplo`, (error as Error).message);
      return {};
    }
  }

  /** Registra los datos de un servicio y los restaura si ya estaban guardados. */
  register(key: string, source: PersistedSource): void {
    this.sources.set(key, source);
    if (key in this.saved) {
      try {
        source.restore(this.saved[key]);
      } catch (error) {
        this.logger.error(`No se pudieron restaurar los datos de "${key}"`, (error as Error).message);
      }
    }
  }

  /** Agrupa varios cambios seguidos en una sola escritura. */
  scheduleSave(): void {
    if (!this.enabled) {
      return;
    }
    clearTimeout(this.pendingSave);
    this.pendingSave = setTimeout(() => this.save(), 300);
  }

  save(): void {
    if (!this.enabled || this.sources.size === 0) {
      return;
    }
    // Conserva lo guardado de servicios que aún no se registraron, para no perderlo.
    const state: Record<string, unknown> = { ...this.saved };
    for (const [key, source] of this.sources) {
      state[key] = source.dump();
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, serializeState(state), 'utf-8');
      renameSync(temp, this.filePath);
    } catch (error) {
      this.logger.error(`No se pudieron guardar los datos en ${this.filePath}`, (error as Error).message);
    }
  }

  onApplicationShutdown(): void {
    clearTimeout(this.pendingSave);
    clearInterval(this.periodicSave);
    this.save();
  }
}
