import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty } from 'class-validator';

export class CreateAvailabilityPeriodDto {
  @ApiProperty({ example: '2026-12-01', description: 'Fecha de inicio del periodo disponible (YYYY-MM-DD) · HU-019' })
  @IsNotEmpty({ message: 'La fecha de inicio es obligatoria' })
  @IsDateString({}, { message: 'La fecha de inicio debe tener formato válido (YYYY-MM-DD)' })
  startDate: string;

  @ApiProperty({ example: '2026-12-15', description: 'Fecha de fin del periodo disponible (YYYY-MM-DD) · HU-019' })
  @IsNotEmpty({ message: 'La fecha de fin es obligatoria' })
  @IsDateString({}, { message: 'La fecha de fin debe tener formato válido (YYYY-MM-DD)' })
  endDate: string;
}

export class AvailabilityPeriodResponseDto {
  @ApiProperty({ example: 'period-uuid-1', description: 'ID único del periodo de disponibilidad' })
  id: string;

  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento' })
  listingId: string;

  @ApiProperty({ example: '2026-12-01', description: 'Fecha de inicio del periodo disponible' })
  startDate: string;

  @ApiProperty({ example: '2026-12-15', description: 'Fecha de fin del periodo disponible' })
  endDate: string;

  @ApiProperty({ example: true, description: 'Indica que el periodo quedó habilitado para recibir reservas (HU-019 CA1)' })
  availableForBooking: boolean;

  @ApiProperty({ example: '2026-10-19T22:00:00.000Z' })
  createdAt: Date;
}

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

  @ApiPropertyOptional({
    type: [AvailabilityPeriodResponseDto],
    description: 'Periodos disponibles registrados por el anfitrión (HU-019)',
  })
  availablePeriods?: AvailabilityPeriodResponseDto[];
}
