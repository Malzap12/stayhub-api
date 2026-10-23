import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingStatus } from '../../../common/enums/listing-status.enum';
import { PropertyType } from '../../../common/enums/property-type.enum';
import { AdditionalServiceDto } from './listing-response.dto';

export class CancellationRuleDto {
  @ApiProperty({ example: 48, description: 'Horas mínimas de anticipación a la llegada para aplicar este reembolso' })
  minHoursBeforeCheckIn: number;

  @ApiProperty({ example: 100, description: 'Porcentaje del total que se devuelve' })
  refundPercentage: number;
}

export class CancellationPolicyDto {
  @ApiProperty({ example: 'FLEXIBLE' })
  code: string;

  @ApiProperty({ example: 'Flexible' })
  name: string;

  @ApiProperty({ example: 'Reembolso del 100 % si cancelas hasta 48 horas antes de la llegada; después, del 50 %.' })
  description: string;

  @ApiProperty({ type: [CancellationRuleDto] })
  rules: CancellationRuleDto[];
}

export class ListingLocationDto {
  @ApiPropertyOptional({ example: 'Carrera 4 # 57-20, Chapinero Alto' })
  address?: string;

  @ApiPropertyOptional({ example: 'Bogotá' })
  city?: string;

  @ApiPropertyOptional({ example: 'Cundinamarca' })
  department?: string;

  @ApiPropertyOptional({ example: 'Colombia' })
  country?: string;

  @ApiProperty({
    example: 'Carrera 4 # 57-20, Chapinero Alto, Bogotá, Cundinamarca, Colombia',
    description: 'Ubicación textual completa (HU-026 CA1)',
  })
  text: string;
}

/** HU-026 · Detalle público de una publicación (CA1, RF-034). */
export class ListingDetailDto {
  @ApiProperty({ example: 'demo-bogota-chapinero' })
  id: string;

  @ApiProperty({ example: 'Apartamento en Chapinero Alto' })
  title: string;

  @ApiPropertyOptional({ example: 'Apartamento luminoso con balcón.' })
  description?: string;

  @ApiProperty({ type: ListingLocationDto })
  location: ListingLocationDto;

  @ApiPropertyOptional({ enum: PropertyType, example: PropertyType.APARTAMENTO })
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: 'Apartamento', description: 'Nombre del tipo de alojamiento' })
  propertyTypeLabel?: string;

  @ApiPropertyOptional({ example: 2, description: 'Capacidad máxima de huéspedes' })
  maxGuests?: number;

  @ApiPropertyOptional({ example: 1 })
  bedrooms?: number;

  @ApiPropertyOptional({ example: 1 })
  bathrooms?: number;

  @ApiPropertyOptional({ example: 280000, description: 'Precio por noche en COP' })
  pricePerNight?: number;

  @ApiProperty({ example: ['WIFI', 'KITCHEN'], description: 'Servicios del alojamiento' })
  amenities: string[];

  @ApiProperty({ example: ['No fumar'], description: 'Reglas de la casa' })
  rules: string[];

  @ApiProperty({ example: ['https://images.unsplash.com/foto.jpg'] })
  images: string[];

  @ApiProperty({ type: CancellationPolicyDto, description: 'Política de cancelación asociada (Flexible si el anfitrión no eligió)' })
  cancellationPolicy: CancellationPolicyDto;

  @ApiProperty({ type: [AdditionalServiceDto], description: 'Servicios adicionales opcionales con costo por estancia' })
  additionalServices: AdditionalServiceDto[];

  @ApiProperty({ example: 4.9, description: 'Calificación promedio; 0 si aún no tiene reseñas' })
  averageRating: number;

  @ApiProperty({ example: 18, description: 'Cantidad de reseñas' })
  reviewCount: number;

  @ApiPropertyOptional({ example: 'Valentina Rojas' })
  hostName?: string;

  @ApiProperty({ enum: ListingStatus, example: ListingStatus.ACTIVA })
  status: ListingStatus;
}
