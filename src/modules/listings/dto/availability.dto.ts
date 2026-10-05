import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty } from 'class-validator';

export class CheckAvailabilityQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'Fecha de inicio del rango (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-11-30', description: 'Fecha de fin del rango (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  endDate: string;
}

export class AvailabilityResponseDto {
  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento' })
  listingId: string;

  @ApiProperty({ example: true, description: 'Indica si está disponible en las fechas especificadas' })
  isAvailable: boolean;

  @ApiProperty({ example: ['2026-11-05', '2026-11-06'], description: 'Fechas bloqueadas u ocupadas en el rango' })
  blockedDates: string[];

  @ApiProperty({ example: 85.50, description: 'Tarifa base actual por noche' })
  pricePerNight: number;
}
