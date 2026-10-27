import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../../common/enums/booking-status.enum';
import { PaymentResponseDto } from '../../payments/dto/payment.dto';

export class BookingResponseDto {
  @ApiProperty({ example: 'uuid-reserva-789', description: 'ID único de la reserva' })
  id: string;

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

  @ApiPropertyOptional({ type: () => PaymentResponseDto, description: 'Último pago procesado para la reserva (HU-037)' })
  payment?: PaymentResponseDto;
}

export class BookingPaymentResultDto {
  @ApiProperty({ type: () => BookingResponseDto, description: 'Reserva: CONFIRMADA si el pago se aprobó, PENDIENTE si se rechazó' })
  booking: BookingResponseDto;

  @ApiProperty({ type: () => PaymentResponseDto, description: 'Resultado del pago (APROBADO o RECHAZADO) con su referencia' })
  payment: PaymentResponseDto;
}
