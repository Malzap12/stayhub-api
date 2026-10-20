import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingStatus } from '../../../common/enums/listing-status.enum';
import { PropertyType } from '../../../common/enums/property-type.enum';

export class ListingResponseDto {
  @ApiProperty({ example: 'uuid-1234-listing', description: 'Identificador único del alojamiento' })
  id: string;

  @ApiProperty({ example: 'Hermosa cabaña en la montaña' })
  title: string;

  @ApiPropertyOptional({ example: 'Cabaña espaciosa con vista panorámica...' })
  description?: string;

  @ApiPropertyOptional({ example: 'Medellín' })
  city?: string;

  @ApiPropertyOptional({ example: 'Antioquia', description: 'Departamento (HU-010)' })
  department?: string;

  @ApiPropertyOptional({ example: 'Calle 10 # 43-20 · frente al parque', description: 'Dirección o referencia (HU-010)' })
  address?: string;

  @ApiPropertyOptional({ example: 'Colombia' })
  country?: string;

  @ApiPropertyOptional({ enum: PropertyType, example: PropertyType.CABANA, description: 'Tipo de alojamiento (HU-010)' })
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: 85.50 })
  pricePerNight?: number;

  @ApiPropertyOptional({ example: 4 })
  maxGuests?: number;

  @ApiPropertyOptional({ example: 2 })
  bedrooms?: number;

  @ApiPropertyOptional({ example: 2 })
  bathrooms?: number;

  @ApiProperty({ example: ['WIFI', 'POOL'] })
  amenities: string[];

  @ApiProperty({ example: ['No fumar'], description: 'Reglas de la casa (HU-010)' })
  rules: string[];

  @ApiProperty({ example: ['https://storage.stayhub.com/img1.jpg'] })
  images: string[];

  @ApiProperty({ example: false, description: 'Indica si la publicación tiene toda la información básica (HU-010 CA4)' })
  isComplete: boolean;

  @ApiProperty({ example: ['description', 'images'], description: 'Campos pendientes por completar (HU-010 CA4)' })
  missingFields: string[];

  @ApiProperty({ example: 4.85, description: 'Calificación promedio' })
  rating: number;

  @ApiProperty({ example: 24, description: 'Total de reseñas' })
  reviewCount: number;

  @ApiProperty({ example: 'uuid-user-host-123', description: 'ID del anfitrión' })
  hostId: string;

  @ApiPropertyOptional({ example: 'Laura Restrepo', description: 'Nombre del anfitrión' })
  hostName?: string;

  @ApiPropertyOptional({ enum: ListingStatus, example: ListingStatus.ACTIVA, description: 'Estado de la publicación (HU-050)' })
  status?: ListingStatus;

  @ApiPropertyOptional({ example: '2026-10-14T10:00:00.000Z', description: 'Fecha de solicitud de revisión (HU-050 CA1)' })
  requestedAt?: Date;

  @ApiPropertyOptional({ example: 'Faltan fotografías del exterior', description: 'Motivo de devolución visible para el anfitrión (HU-050 CA3)' })
  returnReason?: string;

  @ApiProperty({ example: '2026-10-05T00:00:00.000Z' })
  createdAt: Date;
}

export class PaginatedListingsResponseDto {
  @ApiProperty({ type: [ListingResponseDto] })
  data: ListingResponseDto[];

  @ApiProperty({ example: 50, description: 'Total de resultados encontrados' })
  total: number;

  @ApiProperty({ example: 1, description: 'Página actual' })
  page: number;

  @ApiProperty({ example: 5, description: 'Total de páginas' })
  totalPages: number;
}
