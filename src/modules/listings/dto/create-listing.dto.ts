import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, IsArray, IsOptional, ArrayNotEmpty, MinLength, MaxLength } from 'class-validator';

export class CreateListingDto {
  @ApiProperty({ example: 'Hermosa cabaña en la montaña', description: 'Título del alojamiento', minLength: 5, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(100)
  title: string;

  @ApiProperty({ example: 'Cabaña espaciosa con vista panorámica, chimenea y jacuzzi.', description: 'Descripción detallada' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 'Calle 10 # 43-20', description: 'Dirección física' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Medellín', description: 'Ciudad del alojamiento' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Colombia', description: 'País del alojamiento' })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiProperty({ example: 85.50, description: 'Precio por noche en USD', minimum: 1 })
  @IsNumber()
  @Min(1)
  pricePerNight: number;

  @ApiProperty({ example: 4, description: 'Capacidad máxima de huéspedes', minimum: 1 })
  @IsNumber()
  @Min(1)
  maxGuests: number;

  @ApiProperty({ example: 2, description: 'Cantidad de habitaciones', minimum: 1 })
  @IsNumber()
  @Min(1)
  bedrooms: number;

  @ApiProperty({ example: 2, description: 'Cantidad de baños', minimum: 1 })
  @IsNumber()
  @Min(1)
  bathrooms: number;

  @ApiProperty({ example: ['WIFI', 'AIR_CONDITIONING', 'KITCHEN', 'POOL'], description: 'Lista de amenidades' })
  @IsArray()
  @IsString({ each: true })
  amenities: string[];

  @ApiProperty({ example: ['https://storage.stayhub.com/img1.jpg'], description: 'URLs de fotos del alojamiento' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  images: string[];
}
