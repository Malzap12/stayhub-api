import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsNumber, Min } from 'class-validator';

export class QuoteBookingDto {
  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento a cotizar' })
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @ApiProperty({ example: '2026-11-01', description: 'Fecha de llegada (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  checkIn: string;

  @ApiProperty({ example: '2026-11-06', description: 'Fecha de salida (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  checkOut: string;

  @ApiProperty({ example: 2, description: 'Número de huéspedes', minimum: 1 })
  @IsNumber()
  @Min(1)
  guests: number;
}

export class QuoteResponseDto {
  @ApiProperty({ example: 'uuid-1234-listing' })
  listingId: string;

  @ApiProperty({ example: '2026-11-01' })
  checkIn: string;

  @ApiProperty({ example: '2026-11-06' })
  checkOut: string;

  @ApiProperty({ example: 5, description: 'Número total de noches' })
  nights: number;

  @ApiProperty({ example: 85.50, description: 'Precio base por noche en USD' })
  nightlyRate: number;

  @ApiProperty({ example: 427.50, description: 'Subtotal noches (noches x tarifa)' })
  baseAmount: number;

  @ApiProperty({ example: 35.00, description: 'Tarifa de limpieza fija' })
  cleaningFee: number;

  @ApiProperty({ example: 55.50, description: 'Comisión de servicio de la plataforma (12%)' })
  serviceFee: number;

  @ApiProperty({ example: 518.00, description: 'Monto total a pagar en USD' })
  totalAmount: number;

  @ApiProperty({ example: 'USD', description: 'Moneda' })
  currency: string;
}
