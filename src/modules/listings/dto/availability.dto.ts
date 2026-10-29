import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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


export class UpdateAvailabilityPeriodDto {
  @ApiPropertyOptional({ example: '2027-03-05', description: 'Nueva fecha de inicio del periodo disponible (YYYY-MM-DD) · HU-020' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de inicio debe tener formato válido (YYYY-MM-DD)' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-03-15', description: 'Nueva fecha de fin del periodo disponible (YYYY-MM-DD) · HU-020' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de fin debe tener formato válido (YYYY-MM-DD)' })
  endDate?: string;
}

export class AffectedBookingDto {
  @ApiProperty({ example: 'booking-uuid-1', description: 'ID de la reserva confirmada afectada' })
  bookingId: string;

  @ApiPropertyOptional({ example: 'STAY-12345', description: 'Código amigable de la reserva' })
  code?: string;

  @ApiProperty({ example: '2027-03-10', description: 'Fecha de llegada de la reserva' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-12', description: 'Fecha de salida de la reserva' })
  checkOut: string;
}

export class PeriodHasBookingsErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 'No es posible modificar o eliminar el periodo porque contiene reservas confirmadas.' })
  message: string;

  @ApiProperty({ type: [AffectedBookingDto], description: 'Listado de reservas confirmadas afectadas (HU-020 CA2)' })
  affectedBookings: AffectedBookingDto[];

  @ApiProperty({ type: [AffectedBookingDto], description: 'Alias de reservas confirmadas afectadas (HU-020 CA2)' })
  affectedReservations: AffectedBookingDto[];
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

export class ConflictingPeriodDto {
  @ApiProperty({ example: 'period-uuid-1' })
  id: string;

  @ApiProperty({ example: '2026-12-01' })
  startDate: string;

  @ApiProperty({ example: '2026-12-15' })
  endDate: string;
}

/** HU-019 CA3 · Respuesta 400 cuando el periodo se superpone con otro ya registrado. */
export class AvailabilityOverlapErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    example: 'El periodo solicitado se superpone con el periodo existente del 2026-12-01 al 2026-12-15.',
  })
  message: string;

  @ApiPropertyOptional({ type: ConflictingPeriodDto, description: 'Periodo ya registrado con el que se superpone (CA3)' })
  conflictingPeriod?: ConflictingPeriodDto;
}

/**
 * HU-023 · Bloquear automáticamente el periodo reservado (CA1, CA2, CA3, RF-029, RF-030, RN-011, RN-028).
 * Intervalo de noches [llegada, salida) (AMB-09): del 10 al 12 bloquea las noches del 10 y del 11.
 */
export class BlockReservedPeriodDto {
  @ApiPropertyOptional({ example: '2027-03-10', description: 'Fecha de llegada / inicio del bloqueo (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2027-03-12', description: 'Fecha de salida / fin del bloqueo (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  checkOut?: string;

  @ApiPropertyOptional({ example: '2027-03-10', description: 'Alias de fecha de llegada (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-03-12', description: 'Alias de fecha de salida (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'booking-uuid-1', description: 'ID de la reserva confirmada que origina el bloqueo' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({
    enum: ['RESERVA', 'BLOQUEO'],
    default: 'RESERVA',
    description: 'HU-022 CA2: RESERVA (reserva confirmada) o BLOQUEO (el anfitrión bloquea fechas). Un huésped solo registra reservas.',
  })
  @IsOptional()
  @IsIn(['RESERVA', 'BLOQUEO'], { message: 'El tipo debe ser RESERVA o BLOQUEO' })
  type?: 'RESERVA' | 'BLOQUEO';
}

export class BlockedPeriodResponseDto {
  @ApiProperty({ example: 'block-uuid-1', description: 'ID único del bloqueo de periodo reservado' })
  id: string;

  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento' })
  listingId: string;

  @ApiPropertyOptional({ example: 'booking-uuid-1', description: 'ID de la reserva asociada' })
  bookingId?: string;

  @ApiPropertyOptional({
    enum: ['RESERVA', 'BLOQUEO'],
    example: 'RESERVA',
    description:
      'HU-022 CA2: RESERVA (reserva confirmada) o BLOQUEO (fechas bloqueadas por el anfitrión)',
  })
  type?: 'RESERVA' | 'BLOQUEO';

  @ApiProperty({ example: '2027-03-10', description: 'Fecha de llegada (inicio del intervalo [llegada, salida))' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-12', description: 'Fecha de salida (fin exclusivo del intervalo [llegada, salida))' })
  checkOut: string;

  @ApiProperty({
    example: ['2027-03-10', '2027-03-11'],
    description: 'Noches bloqueadas dentro del intervalo [llegada, salida) · HU-023 CA1',
  })
  blockedNights: string[];

  @ApiProperty({ example: '2026-10-21T22:00:00.000Z' })
  createdAt: Date;
}

export class CheckAvailabilityQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'Fecha de llegada / inicio del rango (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-11-30', description: 'Fecha de salida / fin del rango (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  endDate: string;
}

export class AvailabilityResponseDto {
  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento' })
  listingId: string;

  @ApiProperty({ example: true, description: 'Indica si está disponible en las fechas especificadas' })
  isAvailable: boolean;

  @ApiProperty({ example: ['2026-11-05', '2026-11-06'], description: 'Noches bloqueadas u ocupadas en el rango [startDate, endDate) · HU-023' })
  blockedDates: string[];

  @ApiProperty({ example: 85.50, description: 'Tarifa base actual por noche' })
  pricePerNight: number;

  @ApiPropertyOptional({
    type: [AvailabilityPeriodResponseDto],
    description: 'Periodos disponibles registrados por el anfitrión (HU-019)',
  })
  availablePeriods?: AvailabilityPeriodResponseDto[];

  @ApiPropertyOptional({
    type: [BlockedPeriodResponseDto],
    description: 'Periodos reservados o bloqueados del alojamiento (HU-023)',
  })
  reservedPeriods?: BlockedPeriodResponseDto[];
}
