import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../../common/enums/booking-status.enum';
import { PaymentResponseDto } from '../../payments/dto/payment.dto';
import { QuoteResponseDto } from './quote-booking.dto';

/** HU-040 · Registro de la cancelación (CA3 · RF-056, RN-017). */
export class BookingCancellationDto {
  @ApiProperty({ example: 'huesped@stayhub.com', description: 'Usuario que canceló' })
  cancelledBy: string;

  @ApiProperty({ example: '2026-11-05T14:30:00.000Z', description: 'Fecha y hora de la cancelación' })
  cancelledAt: string;

  @ApiProperty({ example: 'Cambio imprevisto de itinerario' })
  reason: string;

  @ApiProperty({ example: 'FLEXIBLE', description: 'Política de cancelación aplicada (HU-039)' })
  policy: string;

  @ApiProperty({ example: 100, description: 'Porcentaje de devolución según la anticipación a la llegada' })
  refundPercentage: number;

  @ApiProperty({ example: 1100000, description: 'Valor reembolsable: total menos la tarifa de servicio' })
  refundableAmount: number;

  @ApiProperty({ example: 1100000, description: 'Valor de la devolución simulada, sin movimiento de dinero real (RN-030)' })
  refundAmount: number;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: 'CANCELADA', description: 'Estado final de la reserva' })
  finalStatus: string;

  @ApiProperty({ example: ['2026-11-20', '2026-11-21'], description: 'Noches que volvieron a estar disponibles (RF-055)' })
  releasedNights: string[];
}

export class BookingResponseDto {
  @ApiProperty({ example: 'uuid-reserva-789', description: 'ID único de la reserva' })
  id: string;

  @ApiPropertyOptional({ example: 'RES-8KQ2M7X1', description: 'Cdigo amigable de la reserva (HU-030 CA1)' })
  code?: string;

  @ApiProperty({ example: 'uuid-1234-listing', description: 'ID del alojamiento reservado' })
  listingId: string;

  @ApiProperty({ example: 'uuid-huesped-456', description: 'ID del usuario huésped' })
  guestId: string;

  @ApiProperty({ example: '2026-11-01' })
  checkIn: string;

  @ApiProperty({ example: '2026-11-06' })
  checkOut: string;

  @ApiProperty({ example: 2 })
  guests: number;

  @ApiProperty({ example: 518.00, description: 'Monto total facturado' })
  totalAmount: number;

  @ApiPropertyOptional({ example: 55.50, description: 'Tarifa de servicio de la plataforma con que se creó la reserva (HU-029 CA2)' })
  serviceFee?: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.PENDIENTE, description: 'Estado actual de la reserva' })
  status: BookingStatus;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', description: 'Clave de idempotencia asociada' })
  idempotencyKey: string;

  @ApiPropertyOptional({ example: 'Llegaremos tarde alrededor de las 10 PM.' })
  specialRequests?: string;

  @ApiProperty({ example: '2026-10-05T09:50:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({ type: BookingCancellationDto, description: 'Registro de la cancelación, presente cuando la reserva está CANCELADA (HU-040)' })
  cancellation?: BookingCancellationDto;

  @ApiPropertyOptional({ example: 'Apartamento en Chapinero Alto', description: 'Título de la publicación (solo en Mis reservas)' })
  listingTitle?: string;

  @ApiPropertyOptional({ example: 'Bogotá', description: 'Ciudad de la publicación (solo en Mis reservas)' })
  listingCity?: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1', description: 'Primera imagen de la publicación (solo en Mis reservas)' })
  listingImage?: string;

  @ApiPropertyOptional({ example: 'Flexible', description: 'Política de cancelación de la publicación (solo en Mis reservas)' })
  cancellationPolicyName?: string;

  @ApiPropertyOptional({ type: () => PaymentResponseDto, description: 'Último pago procesado para la reserva (HU-037)' })
  payment?: PaymentResponseDto;

  @ApiPropertyOptional({ description: 'Desglose detallado de precios y tarifas vigente al confirmar (HU-030 CA2)' })
  breakdown?: QuoteResponseDto;

  @ApiPropertyOptional({ example: 3 })
  nights?: number;

  @ApiPropertyOptional({ example: 200000 })
  nightlyRate?: number;

  @ApiPropertyOptional({ example: 600000 })
  baseAmount?: number;

  @ApiPropertyOptional({ example: 10 })
  discountPercentage?: number;

  @ApiPropertyOptional({ example: 60000 })
  discount?: number;

  @ApiPropertyOptional({ example: 50000 })
  cleaningFee?: number;

  @ApiPropertyOptional()
  additionalServices?: Array<{ name: string; cost: number }>;

  @ApiPropertyOptional({ example: 80000 })
  additionalServicesTotal?: number;

  @ApiPropertyOptional({ example: 670000 })
  subtotal?: number;

  @ApiPropertyOptional({ example: 10 })
  serviceFeePercentage?: number;
}

export class BookingPaymentResultDto {
  @ApiProperty({ type: () => BookingResponseDto, description: 'Reserva: CONFIRMADA si el pago se aprobó, PENDIENTE si se rechazó' })
  booking: BookingResponseDto;

  @ApiProperty({ type: () => PaymentResponseDto, description: 'Resultado del pago (APROBADO o RECHAZADO) con su referencia' })
  payment: PaymentResponseDto;
}
