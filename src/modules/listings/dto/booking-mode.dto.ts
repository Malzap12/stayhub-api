import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BookingMode } from '../../../common/enums/booking-mode.enum';

export const BOOKING_MODE_MESSAGE = 'Elige una modalidad de reserva válida: inmediata o con aprobación';

/** HU-018 CA2: modalidad que el anfitrión elige para su publicación (RF-022, RN-015). */
export class UpdateBookingModeDto {
  @ApiProperty({
    enum: BookingMode,
    example: BookingMode.CON_APROBACION,
    description: 'INMEDIATA confirma la reserva al aprobarse el pago; CON_APROBACION deja las nuevas solicitudes en PENDIENTE_APROBACION hasta que el anfitrión decida',
  })
  @IsEnum(BookingMode, { message: BOOKING_MODE_MESSAGE })
  mode: BookingMode;
}

export class BookingModeResponseDto {
  @ApiProperty({ example: 'listing-123' })
  listingId: string;

  @ApiProperty({ enum: BookingMode, example: BookingMode.CON_APROBACION })
  bookingMode: BookingMode;

  @ApiProperty({ example: 'Las nuevas solicitudes quedarán pendientes hasta que las apruebes.' })
  message: string;
}
