import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PropertyType } from '../../../common/enums/property-type.enum';
import type { CancellationPolicyCode } from '../cancellation-policies';

/**
 * HU-010 · Crear una publicación en borrador (RF-013, RF-014).
 * Solo el título es obligatorio (CA4); el resto se puede completar después.
 */
export class CreateListingDto {
  @ApiProperty({ example: 'Hermosa cabaña en la montaña', description: 'Título del alojamiento', minLength: 5, maxLength: 100 })
  @IsString({ message: 'El título debe ser un texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MinLength(5, { message: 'El título debe tener al menos 5 caracteres' })
  @MaxLength(100, { message: 'El título no puede superar 100 caracteres' })
  title: string;

  @ApiPropertyOptional({ example: 'Cabaña espaciosa con vista panorámica, chimenea y jacuzzi.', description: 'Descripción detallada' })
  @IsOptional()
  @IsString({ message: 'La descripción debe ser un texto' })
  description?: string;

  @ApiPropertyOptional({ example: 'Medellín', description: 'Ciudad del alojamiento (AMB-18)' })
  @IsOptional()
  @IsString({ message: 'La ciudad debe ser un texto' })
  city?: string;

  @ApiPropertyOptional({ example: 'Antioquia', description: 'Departamento del alojamiento (AMB-18)' })
  @IsOptional()
  @IsString({ message: 'El departamento debe ser un texto' })
  department?: string;

  @ApiPropertyOptional({ example: 'Calle 10 # 43-20 · frente al parque', description: 'Dirección o referencia' })
  @IsOptional()
  @IsString({ message: 'La dirección o referencia debe ser un texto' })
  address?: string;

  @ApiPropertyOptional({ example: 'Colombia', description: 'País del alojamiento', default: 'Colombia' })
  @IsOptional()
  @IsString({ message: 'El país debe ser un texto' })
  country?: string;

  @ApiPropertyOptional({ enum: PropertyType, example: PropertyType.CABANA, description: 'Tipo de alojamiento' })
  @IsOptional()
  @IsEnum(PropertyType, { message: 'Selecciona un tipo de alojamiento válido' })
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: 4, description: 'Capacidad máxima de huéspedes (CA2: mayor que 0)', minimum: 1 })
  @IsOptional()
  @IsInt({ message: 'La capacidad debe ser un número entero' })
  @Min(1, { message: 'La capacidad debe ser mayor que 0' })
  maxGuests?: number;

  @ApiPropertyOptional({ example: 320000, description: 'Precio por noche (CA2: mayor que 0)' })
  @IsOptional()
  @IsNumber({}, { message: 'El precio por noche debe ser un número' })
  @IsPositive({ message: 'El precio por noche debe ser mayor que 0' })
  pricePerNight?: number;

  @ApiPropertyOptional({ example: 2, description: 'Cantidad de habitaciones', minimum: 0 })
  @IsOptional()
  @IsInt({ message: 'Las habitaciones deben ser un número entero' })
  @Min(0, { message: 'Las habitaciones no pueden ser negativas' })
  bedrooms?: number;

  @ApiPropertyOptional({ example: 2, description: 'Cantidad de baños', minimum: 0 })
  @IsOptional()
  @IsInt({ message: 'Los baños deben ser un número entero' })
  @Min(0, { message: 'Los baños no pueden ser negativos' })
  bathrooms?: number;

  @ApiPropertyOptional({ example: ['WIFI', 'COCINA', 'PISCINA'], description: 'Servicios del alojamiento' })
  @IsOptional()
  @IsArray({ message: 'Los servicios deben ser una lista' })
  @IsString({ each: true, message: 'Cada servicio debe ser un texto' })
  amenities?: string[];

  @ApiPropertyOptional({ example: ['No fumar', 'No se admiten fiestas'], description: 'Reglas de la casa' })
  @IsOptional()
  @IsArray({ message: 'Las reglas deben ser una lista' })
  @IsString({ each: true, message: 'Cada regla debe ser un texto' })
  rules?: string[];

  @ApiPropertyOptional({ example: ['https://storage.stayhub.com/img1.jpg'], description: 'URLs de las imágenes' })
  @IsOptional()
  @IsArray({ message: 'Las imágenes deben ser una lista' })
  @IsString({ each: true, message: 'Cada imagen debe ser una URL en texto' })
  images?: string[];

  @ApiPropertyOptional({
    example: 'FLEXIBLE',
    enum: ['FLEXIBLE'],
    description: 'Política de cancelación asociada del catálogo (HU-039, por defecto FLEXIBLE)',
  })
  @IsOptional()
  @IsIn(['FLEXIBLE'], { message: 'Selecciona una política de cancelación válida del catálogo' })
  cancellationPolicy?: CancellationPolicyCode;
}
