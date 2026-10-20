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

export class HostNotificationDto {
  @ApiProperty({ example: 'notif-uuid-1' })
  id: string;

  @ApiProperty({ example: 'uuid-user-host-123' })
  hostId: string;

  @ApiProperty({ example: 'uuid-1234-listing' })
  listingId: string;

  @ApiProperty({ example: 'APROBADA', enum: ['APROBADA', 'DEVUELTA'] })
  type: 'APROBADA' | 'DEVUELTA';

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

  @ApiProperty({ type: HostNotificationDto })
  notification: HostNotificationDto;
}
