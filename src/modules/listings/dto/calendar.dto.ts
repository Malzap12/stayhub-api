import { ApiProperty } from '@nestjs/swagger';

/**
 * Estado de una noche (la noche del día indicado) en el calendario · HU-022.
 * Vista pública: DISPONIBLE, NO_DISPONIBLE o PASADA.
 * Vista del anfitrión: DISPONIBLE, RESERVADA, BLOQUEADA, SIN_PERIODO (fuera de los periodos disponibles) o PASADA.
 */
export type CalendarDayStatus = 'DISPONIBLE' | 'NO_DISPONIBLE' | 'RESERVADA' | 'BLOQUEADA' | 'SIN_PERIODO' | 'PASADA';

export const CALENDAR_DAY_STATUSES: CalendarDayStatus[] = [
  'DISPONIBLE',
  'NO_DISPONIBLE',
  'RESERVADA',
  'BLOQUEADA',
  'SIN_PERIODO',
  'PASADA',
];

export class CalendarDayDto {
  @ApiProperty({ example: '2026-11-10' })
  date: string;

  @ApiProperty({ enum: CALENDAR_DAY_STATUSES, example: 'DISPONIBLE' })
  status: CalendarDayStatus;
}

export class CalendarMonthDto {
  @ApiProperty({ example: '2026-11', description: 'Mes en formato AAAA-MM' })
  month: string;

  @ApiProperty({ type: [CalendarDayDto] })
  days: CalendarDayDto[];
}

export class ListingCalendarDto {
  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({
    enum: ['PUBLICA', 'ANFITRION'],
    example: 'PUBLICA',
    description: 'PUBLICA: disponible o no disponible (CA1). ANFITRION: distingue reservadas y bloqueadas (CA2).',
  })
  view: 'PUBLICA' | 'ANFITRION';

  @ApiProperty({ example: '2026-10-22', description: 'Hoy en America/Bogota' })
  today: string;

  @ApiProperty({ example: '2026-10-01', description: 'Primer día del calendario (inicio del mes actual)' })
  from: string;

  @ApiProperty({ example: '2027-09-30', description: 'Último día del calendario (fin del 12.º mes)' })
  to: string;

  @ApiProperty({ type: [CalendarMonthDto], description: '12 meses desde el mes actual' })
  months: CalendarMonthDto[];
}
