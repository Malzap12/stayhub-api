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

/** HU-042 · Registro de la cancelación expuesto al anfitrión sin revelar el correo privado del huésped. */
export class HostBookingCancellationDto {
  @ApiProperty({ example: '2026-11-05T14:30:00.000Z', description: 'Fecha y hora de la cancelación' })
  cancelledAt: string;

  @ApiProperty({ example: 'Daño imprevisto en el sistema hidráulico del alojamiento' })
  reason: string;

  @ApiProperty({ example: 'CANCELACION_ANFITRION', description: 'Política o regla de cancelación aplicada' })
  policy: string;

  @ApiProperty({ example: 100, description: 'Porcentaje de devolución simulada' })
  refundPercentage: number;

  @ApiProperty({ example: 900000, description: 'Monto base reembolsable' })
  refundableAmount: number;

  @ApiProperty({ example: 900000, description: 'Valor de la devolución simulada al huésped' })
  refundAmount: number;

  @ApiProperty({
    example: 'Cancelación por el anfitrión: devolución del 100 % del total pagado, incluida la tarifa de servicio',
  })
  appliedRule: string;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: 'CANCELADA', description: 'Estado final de la reserva' })
  finalStatus: string;

  @ApiProperty({ example: ['2026-11-01', '2026-11-02', '2026-11-03'], description: 'Noches liberadas (RN-029)' })
  releasedNights: string[];
}

/** HU-035 CA2 y HU-042 · Detalle de una reserva recibida. */
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

  @ApiPropertyOptional({
    type: HostBookingCancellationDto,
    description: 'Detalle de la cancelación cuando la reserva está CANCELADA (HU-042).',
  })
  cancellation?: HostBookingCancellationDto;
}
