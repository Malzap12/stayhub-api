import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ListingStatus } from '../../../common/enums/listing-status.enum';

export class ReturnListingDto {
  @ApiProperty({
    example: 'Las fotografías de la habitación principal están borrosas y falta especificar normas de la casa.',
    description: 'Motivo de devolución que verá el anfitrión (HU-050 CA3)',
  })
  @IsString()
  @IsNotEmpty({ message: 'El motivo de devolución es obligatorio' })
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres' })
  reason: string;
}

/** HU-051 · Motivo del bloqueo de una publicación engañosa. */
export class BlockListingDto {
  @ApiProperty({
    example: 'Las fotografías no corresponden al inmueble y la dirección publicada es falsa.',
    description: 'Motivo del bloqueo que verán el anfitrión y la auditoría (HU-051 CA1)',
  })
  @IsString()
  @IsNotEmpty({ message: 'El motivo del bloqueo es obligatorio' })
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres' })
  reason: string;
}

export class HostNotificationDto {
  @ApiProperty({ example: 'notif-uuid-1' })
  id: string;

  @ApiProperty({ example: 'uuid-user-host-123' })
  hostId: string;

  @ApiProperty({ example: 'uuid-1234-listing' })
  listingId: string;

  @ApiProperty({ example: 'APROBADA', enum: ['APROBADA', 'DEVUELTA', 'BLOQUEADA'] })
  type: 'APROBADA' | 'DEVUELTA' | 'BLOQUEADA';

  @ApiProperty({ example: 'Tu publicación "Villa en Barú" fue aprobada y ya está ACTIVA en las búsquedas.' })
  message: string;

  @ApiPropertyOptional({ example: 'Faltan fotos del baño.' })
  reason?: string;

  @ApiProperty({ example: '2026-10-19T15:00:00.000Z' })
  createdAt: Date;
}

export class ListingModerationResponseDto {
  @ApiProperty({ example: 'uuid-1234-listing' })
  listingId: string;

  @ApiProperty({ enum: ListingStatus, example: ListingStatus.ACTIVA })
  status: ListingStatus;

  @ApiPropertyOptional({ example: 'Las fotos no cumplen la resolución mínima.' })
  returnReason?: string;

  @ApiPropertyOptional({ example: 'Las fotografías no corresponden al inmueble.', description: 'Motivo del bloqueo (HU-051)' })
  blockReason?: string;

  @ApiPropertyOptional({ enum: ListingStatus, example: ListingStatus.ACTIVA, description: 'Estado anterior al bloqueo (HU-051)' })
  previousStatus?: ListingStatus;

  @ApiPropertyOptional({
    type: [String],
    example: ['RES-8D17F0D7'],
    description: 'Códigos de las reservas futuras que pasaron a EN_REVISION al bloquear la publicación (HU-051 CA2)',
  })
  bookingsUnderReview?: string[];

  @ApiProperty({ type: HostNotificationDto })
  notification: HostNotificationDto;
}
