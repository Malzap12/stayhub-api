import { Injectable, BadRequestException, Optional, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import {
  DEFAULT_SERVICE_FEE_PERCENT,
  MAX_SERVICE_FEE_PERCENT,
  MIN_SERVICE_FEE_PERCENT,
  ServiceFeeResponseDto,
  UpdateServiceFeeDto,
} from './dto/service-fee.dto';

/**
 * HU-029 CA1/CA3: valida que el porcentaje de la tarifa de servicio esté entre 0 % y 30 % (RN-014).
 */
export function validateServiceFee(percent: unknown): string | null {
  if (typeof percent !== 'number' || Number.isNaN(percent) || !Number.isFinite(percent)) {
    return 'El porcentaje de la tarifa de servicio debe ser un número.';
  }
  if (percent < MIN_SERVICE_FEE_PERCENT || percent > MAX_SERVICE_FEE_PERCENT) {
    return 'El porcentaje de la tarifa de servicio debe estar entre 0 % y 30 %.';
  }
  return null;
}

@Injectable()
export class PlatformConfigService implements OnModuleInit {
  private serviceFeePercent: number = DEFAULT_SERVICE_FEE_PERCENT;
  private updatedAt: Date = new Date();
  private updatedBy?: string = 'sistema';

  constructor(
    private readonly auditService: AuditService,
    @Optional() private readonly persistence?: StatePersistenceService,
  ) {}

  onModuleInit(): void {
    this.persistence?.register('platform-config', {
      dump: () => ({
        serviceFeePercent: this.serviceFeePercent,
        updatedAt: this.updatedAt,
        updatedBy: this.updatedBy,
      }),
      restore: (data) => {
        const state = data as { serviceFeePercent?: number; updatedAt?: Date | string; updatedBy?: string };
        this.serviceFeePercent = typeof state?.serviceFeePercent === 'number' ? state.serviceFeePercent : DEFAULT_SERVICE_FEE_PERCENT;
        this.updatedAt = state?.updatedAt ? new Date(state.updatedAt) : new Date();
        this.updatedBy = state?.updatedBy ?? 'sistema';
      },
    });
  }

  getServiceFeePercent(): number {
    return this.serviceFeePercent;
  }

  getServiceFee(): ServiceFeeResponseDto {
    return {
      serviceFeePercent: this.serviceFeePercent,
      percentage: this.serviceFeePercent,
      updatedAt: this.updatedAt,
      updatedBy: this.updatedBy,
    };
  }

  /**
   * HU-029 · Configurar la tarifa de servicio (CA1, CA3, RF-040, RN-014, RN-021).
   * Solo el administrador actualiza el porcentaje. Registra en auditoría el valor anterior y el nuevo.
   */
  updateServiceFee(dto: UpdateServiceFeeDto, actor?: string): ServiceFeeResponseDto {
    const raw = dto?.serviceFeePercent ?? (dto as unknown as { percentage?: number })?.percentage;
    const errorMsg = validateServiceFee(raw);

    if (errorMsg) {
      this.auditService.record({
        actor,
        action: AuditAction.SERVICE_FEE_UPDATE,
        entity: 'PlatformConfig',
        entityId: 'service_fee',
        result: AuditResult.FALLIDO,
        detail: `Intento de cambio de tarifa de servicio inválido (${raw}%): ${errorMsg}`,
      });
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: errorMsg,
        fieldErrors: { serviceFeePercent: errorMsg },
      });
    }

    const previousValue = this.serviceFeePercent;
    const newValue = Number(raw);

    this.serviceFeePercent = newValue;
    this.updatedAt = new Date();
    this.updatedBy = actor ?? 'admin';

    // CA3: auditoría con el valor anterior y el nuevo
    this.auditService.record({
      actor,
      action: AuditAction.SERVICE_FEE_UPDATE,
      entity: 'PlatformConfig',
      entityId: 'service_fee',
      result: AuditResult.EXITOSO,
      detail: `Tarifa de servicio actualizada: valor anterior ${previousValue} %, valor nuevo ${newValue} %`,
    });

    return this.getServiceFee();
  }
}
