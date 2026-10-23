import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/** HU-015 CA2 (RN-013): el descuento por estancia larga va de 0 % a 50 %. */
export const MIN_LONG_STAY_DISCOUNT_PERCENT = 0;
export const MAX_LONG_STAY_DISCOUNT_PERCENT = 50;
/** HU-015 CA2: el descuento aplica desde un número mínimo de noches (al menos 1). */
export const MIN_LONG_STAY_NIGHTS = 1;

/**
 * HU-015 · Definir limpieza y descuento por estancia larga (RF-019, RN-004, RN-013).
 * La tarifa de limpieza es fija por estancia (AMB-06) y el descuento se aplica por duración (AMB-07).
 */
export class UpdateListingPricingDto {
  @ApiProperty({ example: 60000, description: 'Tarifa de limpieza fija por estancia en COP (CA1: mayor o igual a 0)', minimum: 0 })
  @IsNumber({}, { message: 'La tarifa de limpieza debe ser un número' })
  @Min(0, { message: 'La tarifa de limpieza debe ser mayor o igual a 0 COP' })
  cleaningFee: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Porcentaje de descuento por estancia larga (CA2: entre 0 y 50). 0 u omitido = sin descuento',
    minimum: MIN_LONG_STAY_DISCOUNT_PERCENT,
    maximum: MAX_LONG_STAY_DISCOUNT_PERCENT,
  })
  @IsOptional()
  @IsNumber({}, { message: 'El porcentaje de descuento debe ser un número' })
  @Min(MIN_LONG_STAY_DISCOUNT_PERCENT, { message: 'El descuento debe estar entre 0 % y 50 %' })
  @Max(MAX_LONG_STAY_DISCOUNT_PERCENT, { message: 'El descuento debe estar entre 0 % y 50 %' })
  longStayDiscountPercent?: number;

  @ApiPropertyOptional({
    example: 7,
    description: 'Noches mínimas para aplicar el descuento (CA2). Obligatorio si el descuento es mayor que 0',
    minimum: MIN_LONG_STAY_NIGHTS,
  })
  @ValidateIf((dto: UpdateListingPricingDto) => (dto.longStayDiscountPercent ?? 0) > 0 || dto.longStayMinNights != null)
  @IsInt({ message: 'Las noches mínimas deben ser un número entero' })
  @Min(MIN_LONG_STAY_NIGHTS, { message: 'Las noches mínimas deben ser al menos 1' })
  longStayMinNights?: number;
}

export class LongStayDiscountDto {
  @ApiProperty({ example: 7, description: 'Noches mínimas a partir de las cuales aplica el descuento' })
  minNights: number;

  @ApiProperty({ example: 10, description: 'Porcentaje de descuento sobre el subtotal de noches' })
  percentage: number;
}

export class ListingPricingResponseDto {
  @ApiProperty({ example: 'listing-uuid' })
  listingId: string;

  @ApiProperty({ example: 60000, description: 'Tarifa de limpieza fija por estancia (COP)' })
  cleaningFee: number;

  @ApiPropertyOptional({ type: LongStayDiscountDto, nullable: true, description: 'Descuento por estancia larga; null si no hay' })
  longStayDiscount: LongStayDiscountDto | null;

  @ApiProperty({ example: 'COP' })
  currency: string;
}
