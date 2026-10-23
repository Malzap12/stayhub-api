import { Injectable, Optional } from '@nestjs/common';
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
}

export interface RecordAuditEventInput {
  actor?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  result: AuditResult;
  detail?: string;
}

export interface AuditEventFilters {
  actor?: string;
  action?: AuditAction;
  entity?: string;
  result?: AuditResult;
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
        (data as AuditEvent[]).forEach((event) => this.events.push(Object.freeze({ ...event })));
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
    });
    this.events.push(event);
    return event;
  }

  findAll(filters: AuditEventFilters = {}): AuditEvent[] {
    return this.events.filter(
      (event) =>
        (!filters.actor ||
          event.actor.toLowerCase() === filters.actor.trim().toLowerCase()) &&
        (!filters.action || event.action === filters.action) &&
        (!filters.entity || event.entity === filters.entity) &&
        (!filters.result || event.result === filters.result),
    );
  }
}
