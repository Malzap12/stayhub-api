import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingStatus } from '../../../common/enums/listing-status.enum';

export type AdminReasonType = 'DEVUELTA' | 'BLOQUEADA';

/** HU-012 · Elemento del listado «Mis publicaciones» (RF-016). */
export class MyListingDto {
  @ApiProperty({ example: 'listing-7f3c2a10' })
  id: string;

  @ApiProperty({ example: 'Cabaña del Bosque' })
  title: string;

  @ApiPropertyOptional({ example: 'Guatapé', description: 'Ciudad; vacía si el borrador aún no la tiene (CA1)' })
  city?: string;

  @ApiPropertyOptional({ example: 320000, description: 'Precio por noche; vacío si el borrador aún no lo tiene (CA1)' })
  pricePerNight?: number;

  @ApiProperty({ enum: ListingStatus, example: ListingStatus.BORRADOR, description: 'Estado de la publicación (CA1)' })
  status: ListingStatus;

  @ApiProperty({ example: 'Borrador', description: 'Nombre del estado para mostrar al anfitrión' })
  statusLabel: string;

  @ApiPropertyOptional({
    enum: ['DEVUELTA', 'BLOQUEADA'],
    description: 'Indica si la publicación fue devuelta o bloqueada por el administrador (CA2)',
  })
  adminReasonType?: AdminReasonType;

  @ApiPropertyOptional({
    example: 'Las fotografías están oscuras; agrega imágenes del exterior.',
    description: 'Motivo indicado por el administrador al devolver o bloquear la publicación (CA2)',
  })
  adminReason?: string;

  @ApiPropertyOptional({
    example: 'FLEXIBLE',
    description: 'Código de la política de cancelación asociada (HU-017 CA1)',
  })
  cancellationPolicy?: string;

  @ApiProperty({ example: true, description: 'Indica si tiene toda la información básica (HU-010 CA4)' })
  isComplete: boolean;

  @ApiProperty({ example: [], description: 'Campos básicos pendientes (HU-010 CA4)' })
  missingFields: string[];

  @ApiProperty({ example: '2026-10-20T10:00:00.000Z' })
  createdAt: Date;
}
