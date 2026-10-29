import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../../common/enums/booking-status.enum';

/** HU-035 CA1 · Reserva recibida, tal como la ve el anfitrión en el listado (sin datos de contacto). */
export class HostBookingSummaryDto {
  @ApiProperty({ example: 'uuid-reserva-789' })
  id: string;

  @ApiPropertyOptional({ example: 'RES-8KQ2M7X1', description: 'Código de la reserva' })
  code?: string;

  @ApiProperty({ example: '2026-11-01' })
  checkIn: string;

  @ApiProperty({ example: '2026-11-04' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ example: 2, description: 'Número de huéspedes' })
  guests: number;

  @ApiProperty({ example: 'Laura Gómez', description: 'Nombre del huésped que hizo la reserva' })
  guestName: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMADA })
  status: BookingStatus;

  @ApiProperty({ example: 900000 })
  totalAmount: number;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: '2026-10-05T09:50:00.000Z' })
  createdAt: Date;
}

/** HU-035 CA1 · Reservas recibidas agrupadas por alojamiento. */
export class HostListingBookingsDto {
  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({ example: 'Apartamento en Chapinero Alto' })
  listingTitle: string;

  @ApiProperty({ example: 'Bogotá' })
  listingCity: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1' })
  listingImage?: string;

  @ApiProperty({ type: [HostBookingSummaryDto], description: 'Reservas del alojamiento, por fecha de llegada' })
  bookings: HostBookingSummaryDto[];
}

/** HU-035 CA2 · Datos de contacto del huésped; solo se entregan con la reserva CONFIRMADA. */
export class GuestContactDto {
  @ApiProperty({ example: 'Laura Gómez' })
  name: string;

  @ApiProperty({ example: 'laura@correo.com' })
  email: string;

  @ApiPropertyOptional({ example: '+57 300 123 4567' })
  phone?: string;
}

/** HU-035 CA2 · Detalle de una reserva recibida. */
export class HostBookingDetailDto extends HostBookingSummaryDto {
  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({ example: 'Apartamento en Chapinero Alto' })
  listingTitle: string;

  @ApiProperty({ example: 'Bogotá' })
  listingCity: string;

  @ApiPropertyOptional({ example: 'Llegaremos tarde, alrededor de las 10 p. m.' })
  specialRequests?: string;

  @ApiPropertyOptional({ type: [Object], example: [{ name: 'Desayuno', cost: 40000 }], description: 'Servicios adicionales contratados' })
  additionalServices?: Array<{ name: string; cost: number }>;

  @ApiPropertyOptional({
    type: GuestContactDto,
    description: 'Contacto del huésped. Solo se incluye cuando la reserva está CONFIRMADA (privacidad).',
  })
  guestContact?: GuestContactDto;
}
