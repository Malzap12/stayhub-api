import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export const MIN_SERVICE_FEE_PERCENT = 0;
export const MAX_SERVICE_FEE_PERCENT = 30;
export const DEFAULT_SERVICE_FEE_PERCENT = 12;

/**
 * HU-029 · Configurar la tarifa de servicio (RF-040, RN-014).
 * El porcentaje de la tarifa de servicio debe estar entre 0 % y 30 %.
 */
export class UpdateServiceFeeDto {
  @ApiProperty({
    example: 15,
    description: 'Porcentaje de tarifa de servicio de la plataforma (RN-014: 0 % a 30 %)',
    minimum: MIN_SERVICE_FEE_PERCENT,
    maximum: MAX_SERVICE_FEE_PERCENT,
  })
  @IsNumber({}, { message: 'El porcentaje de la tarifa de servicio debe ser un número' })
  @Min(MIN_SERVICE_FEE_PERCENT, { message: 'El porcentaje de la tarifa de servicio debe estar entre 0 % y 30 %' })
  @Max(MAX_SERVICE_FEE_PERCENT, { message: 'El porcentaje de la tarifa de servicio debe estar entre 0 % y 30 %' })
  serviceFeePercent: number;
}

export class ServiceFeeResponseDto {
  @ApiProperty({ example: 12, description: 'Porcentaje vigente de la tarifa de servicio (0 % a 30 %)' })
  serviceFeePercent: number;

  @ApiProperty({ example: 12, description: 'Alias del porcentaje para compatibilidad' })
  percentage: number;

  @ApiProperty({ example: '2026-10-22T22:00:00.000Z', description: 'Fecha de última actualización' })
  updatedAt: Date;

  @ApiProperty({ example: 'admin@inversioneslr.com', description: 'Usuario que realizó la última actualización' })
  updatedBy?: string;
}
