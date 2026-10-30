import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** HU-008 CA2 · Reserva futura confirmada que impide desactivar la cuenta. */
export class UpcomingStayDto {
  @ApiProperty({ example: 'booking-6f1c2a9e' })
  id: string;

  @ApiPropertyOptional({ example: 'RES-8KQ2M7X1' })
  code?: string;

  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({ example: 'Apartamento en Chapinero Alto' })
  listingTitle: string;

  @ApiProperty({ example: '2026-12-10' })
  checkIn: string;

  @ApiProperty({ example: '2026-12-13' })
  checkOut: string;

  @ApiProperty({ example: 2 })
  guests: number;

  @ApiProperty({
    enum: ['HUESPED', 'ANFITRION'],
    example: 'HUESPED',
    description: 'HUESPED: la reserva es tuya; ANFITRION: es de un huésped en uno de tus alojamientos',
  })
  relation: 'HUESPED' | 'ANFITRION';
}

/** HU-008 CA3 · Publicación activa que se pausará al desactivar la cuenta. */
export class ListingToPauseDto {
  @ApiProperty({ example: 'demo-bogota-chapinero' })
  id: string;

  @ApiProperty({ example: 'Apartamento en Chapinero Alto' })
  title: string;
}

/** HU-008 · Revisión previa: qué pasa si desactivo mi cuenta ahora. */
export class DeactivationCheckDto {
  @ApiProperty({ example: true, description: 'false si hay reservas futuras confirmadas (CA2)' })
  canDeactivate: boolean;

  @ApiProperty({ type: [UpcomingStayDto], description: 'Reservas futuras confirmadas como huésped o en tus alojamientos (CA2)' })
  upcomingBookings: UpcomingStayDto[];

  @ApiProperty({ type: [ListingToPauseDto], description: 'Publicaciones activas que pasarán a PAUSADA (CA3)' })
  listingsToPause: ListingToPauseDto[];
}

/** HU-008 CA1 · Resultado de desactivar la cuenta. */
export class DeactivateAccountResponseDto {
  @ApiProperty({ example: 'Tu cuenta quedó desactivada y tu sesión se cerró. Tu historial se conserva.' })
  message: string;

  @ApiProperty({ example: 'DESACTIVADA' })
  status: 'DESACTIVADA';

  @ApiProperty({ type: [ListingToPauseDto], description: 'Publicaciones que pasaron a PAUSADA (CA3)' })
  pausedListings: ListingToPauseDto[];
}

/** HU-008 CA2 · Error 409 cuando hay reservas futuras confirmadas. */
export class DeactivationBlockedDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'RESERVAS_FUTURAS_CONFIRMADAS' })
  code: string;

  @ApiProperty({ example: 'No puedes desactivar tu cuenta: tienes 1 reserva futura confirmada.' })
  message: string;

  @ApiProperty({ type: [UpcomingStayDto] })
  upcomingBookings: UpcomingStayDto[];
}
