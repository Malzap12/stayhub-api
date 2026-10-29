import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, Max } from 'class-validator';

/** HU-016 · Límites de los servicios adicionales de una publicación. */
export const MAX_ADDITIONAL_SERVICES = 10;
export const MAX_ADDITIONAL_SERVICE_COST = 10_000_000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

/** HU-016 CA1 · Servicio adicional opcional con nombre y costo por estancia mayor que 0 (RF-020, RN-004, RN-013). */
export class CreateAdditionalServiceDto {
  @ApiProperty({ example: 'Traslado desde el aeropuerto', minLength: 3, maxLength: 80 })
  @Transform(trim)
  @IsString({ message: 'El nombre del servicio debe ser un texto' })
  @MinLength(3, { message: 'El nombre del servicio debe tener al menos 3 caracteres' })
  @MaxLength(80, { message: 'El nombre del servicio admite máximo 80 caracteres' })
  name: string;

  @ApiProperty({ example: 80000, description: 'Costo por estancia en COP, mayor que 0', minimum: 1, maximum: MAX_ADDITIONAL_SERVICE_COST })
  @IsNumber({}, { message: 'El costo del servicio debe ser un número' })
  @Min(1, { message: 'El costo del servicio debe ser mayor que 0 COP' })
  @Max(MAX_ADDITIONAL_SERVICE_COST, { message: 'El costo del servicio no puede superar 10.000.000 COP' })
  cost: number;
}

/** HU-016 CA2 · Modificar el nombre o el costo de un servicio adicional. */
export class UpdateAdditionalServiceDto {
  @ApiPropertyOptional({ example: 'Traslado ida y vuelta al aeropuerto', minLength: 3, maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'El nombre del servicio debe ser un texto' })
  @MinLength(3, { message: 'El nombre del servicio debe tener al menos 3 caracteres' })
  @MaxLength(80, { message: 'El nombre del servicio admite máximo 80 caracteres' })
  name?: string;

  @ApiPropertyOptional({ example: 95000, description: 'Costo por estancia en COP, mayor que 0' })
  @IsOptional()
  @IsNumber({}, { message: 'El costo del servicio debe ser un número' })
  @Min(1, { message: 'El costo del servicio debe ser mayor que 0 COP' })
  @Max(MAX_ADDITIONAL_SERVICE_COST, { message: 'El costo del servicio no puede superar 10.000.000 COP' })
  cost?: number;
}
