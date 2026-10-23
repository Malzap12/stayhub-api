import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, IsNotEmpty, IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class QuoteBookingDto {
  @ApiProperty({ example: 'demo-bogota-chapinero', description: 'ID del alojamiento a cotizar' })
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @ApiProperty({ example: '2026-11-10', description: 'Fecha de llegada (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString({}, { message: 'La fecha de llegada debe tener el formato AAAA-MM-DD' })
  checkIn: string;

  @ApiProperty({ example: '2026-11-13', description: 'Fecha de salida (YYYY-MM-DD), posterior a la llegada' })
  @IsNotEmpty()
  @IsDateString({}, { message: 'La fecha de salida debe tener el formato AAAA-MM-DD' })
  checkOut: string;

  @ApiProperty({ example: 2, description: 'Número de huéspedes', minimum: 1 })
  @IsNumber()
  @Min(1)
  guests: number;

  @ApiPropertyOptional({
    example: ['Traslado desde el aeropuerto'],
    description: 'HU-027 CA3: nombres de los servicios adicionales de la publicación que se quieren incluir',
  })
  @IsOptional()
  @IsArray({ message: 'Los servicios adicionales deben ser una lista' })
  @ArrayMaxSize(20)
  @IsString({ each: true, message: 'Cada servicio adicional debe ser un texto' })
  additionalServices?: string[];
}

export class QuoteAdditionalServiceDto {
  @ApiProperty({ example: 'Traslado desde el aeropuerto' })
  name: string;

  @ApiProperty({ example: 80000, description: 'Costo por estancia en COP' })
  cost: number;
}

/**
 * HU-027 · Cotización con desglose (RF-036 a RF-038, RN-019).
 * total = (precio base − descuento) + limpieza + servicios adicionales + tarifa de servicio, y la tarifa de
 * servicio es el porcentaje configurado (HU-029) sobre la suma anterior.
 */
export class QuoteResponseDto {
  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({ example: '2026-11-10' })
  checkIn: string;

  @ApiProperty({ example: '2026-11-13' })
  checkOut: string;

  @ApiProperty({ example: 3, description: 'Número de noches' })
  nights: number;

  @ApiProperty({ example: 200000, description: 'Precio por noche en COP' })
  nightlyRate: number;

  @ApiProperty({ example: 600000, description: 'Precio base: noches × precio por noche' })
  baseAmount: number;

  @ApiProperty({ example: 0, description: 'Porcentaje de descuento por estancia larga aplicado (HU-015); 0 si no alcanza las noches mínimas' })
  discountPercentage: number;

  @ApiProperty({ example: 0, description: 'Monto descontado del precio base (HU-015)' })
  discount: number;

  @ApiProperty({ example: 50000, description: 'Tarifa de limpieza por estancia (HU-015)' })
  cleaningFee: number;

  @ApiProperty({ type: [QuoteAdditionalServiceDto], description: 'Servicios adicionales seleccionados, cada uno con su costo (CA3)' })
  additionalServices: QuoteAdditionalServiceDto[];

  @ApiProperty({ example: 0, description: 'Suma de los servicios adicionales seleccionados' })
  additionalServicesTotal: number;

  @ApiProperty({ example: 650000, description: 'Base de la tarifa de servicio: precio base − descuento + limpieza + adicionales' })
  subtotal: number;

  @ApiProperty({ example: 10, description: 'Porcentaje de la tarifa de servicio configurado (HU-029)' })
  serviceFeePercentage: number;

  @ApiProperty({ example: 65000, description: 'Tarifa de servicio: porcentaje configurado sobre el subtotal' })
  serviceFee: number;

  @ApiProperty({ example: 715000, description: 'Total a pagar: subtotal + tarifa de servicio' })
  totalAmount: number;

  @ApiProperty({ example: 'COP', description: 'Moneda de todos los importes (CA4)' })
  currency: string;
}
