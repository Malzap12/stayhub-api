import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { StatePersistenceService } from '../persistence/state-persistence.service';

export const ANONYMOUS_ACTOR = 'anonimo';

export interface AuditEvent {
  readonly id: string;
  readonly actor: string;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId?: string;
  readonly occurredAt: string;
  readonly result: AuditResult;
  readonly detail?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RecordAuditEventInput {
  actor?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  result: AuditResult;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEventFilters {
  actor?: string;
  action?: AuditAction;
  entity?: string;
  result?: AuditResult;
  /** Desde esta fecha (AAAA-MM-DD, hora de Bogotá) o este instante ISO, incluido. */
  from?: string;
  /** Hasta esta fecha (AAAA-MM-DD, hora de Bogotá) o este instante ISO, incluido. */
  to?: string;
}

export interface AuditEventsPageQuery extends AuditEventFilters {
  page?: number;
  limit?: number;
}

export interface AuditEventsPage {
  data: AuditEvent[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_AUDIT_PAGE_SIZE = 20;
export const MAX_AUDIT_PAGE_SIZE = 100;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const BOGOTA_OFFSET = '-05:00';

/** Una fecha sin hora cubre el día completo en Bogotá: desde las 00:00 o hasta las 23:59:59.999. */
function toInstant(value: string | undefined, edge: 'start' | 'end'): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const raw = value.trim();
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}${BOGOTA_OFFSET}`
    : raw;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    throw new BadRequestException(`La fecha «${raw}» no es válida; usa el formato AAAA-MM-DD`);
  }
  return time;
}

/**
 * Bitácora de auditoría de solo inserción (HU-061 · RF-080, RN-021, RN-032).
 * No expone operaciones de actualización ni eliminación (CA2): cada evento
 * se congela al registrarse y las consultas devuelven copias de la lista.
 */
@Injectable()
export class AuditService {
  private readonly events: AuditEvent[] = [];

  /**
   * La bitácora se recupera del disco al crear el servicio (persistencia en volumen).
   * Se registra en el constructor para no exponer ningún método adicional: sigue siendo de solo inserción (CA2).
   */
  constructor(@Optional() persistence?: StatePersistenceService) {
    persistence?.register('audit', {
      dump: () => this.events,
      restore: (data) => {
        this.events.length = 0;
        ((data as AuditEvent[]) ?? []).forEach((event) => this.events.push(Object.freeze({ ...event })));
      },
    });
  }

  record(input: RecordAuditEventInput): AuditEvent {
    const event: AuditEvent = Object.freeze({
      id: randomUUID(),
      actor: input.actor?.trim() || ANONYMOUS_ACTOR,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      occurredAt: new Date().toISOString(),
      result: input.result,
      detail: input.detail,
      metadata: input.metadata ? Object.freeze({ ...input.metadata }) : undefined,
    });
    this.events.push(event);
    return event;
  }

  /** Eventos que cumplen todos los filtros, en el orden en que se registraron (HU-054 CA2). */
  findAll(filters: AuditEventFilters = {}): AuditEvent[] {
    const from = toInstant(filters.from, 'start');
    const to = toInstant(filters.to, 'end');
    if (from !== undefined && to !== undefined && from > to) {
      throw new BadRequestException('La fecha inicial no puede ser posterior a la fecha final');
    }
    const actor = filters.actor?.trim().toLowerCase();
    return this.events.filter((event) => {
      const occurredAt = Date.parse(event.occurredAt);
      return (
        (!actor || event.actor.toLowerCase().includes(actor)) &&
        (!filters.action || event.action === filters.action) &&
        (!filters.entity || event.entity === filters.entity) &&
        (!filters.result || event.result === filters.result) &&
        (from === undefined || occurredAt >= from) &&
        (to === undefined || occurredAt <= to)
      );
    });
  }

  /** HU-054 CA1: los eventos filtrados, del más reciente al más antiguo y paginados. */
  findPage(query: AuditEventsPageQuery = {}): AuditEventsPage {
    const matching = this.findAll(query)
      .map((event, index) => ({ event, index }))
      .sort((a, b) => Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt) || b.index - a.index)
      .map(({ event }) => event);
    const limit = Math.min(MAX_AUDIT_PAGE_SIZE, Math.max(1, Math.trunc(query.limit ?? DEFAULT_AUDIT_PAGE_SIZE)));
    const total = matching.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(totalPages, Math.max(1, Math.trunc(query.page ?? 1)));
    const start = (page - 1) * limit;
    return { data: matching.slice(start, start + limit), page, limit, total, totalPages };
  }
}
