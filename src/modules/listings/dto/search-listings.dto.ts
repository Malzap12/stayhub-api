import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsInt, Min, IsDateString, IsEnum, IsArray, ArrayMaxSize } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PropertyType } from '../../../common/enums/property-type.enum';

/** HU-025 · `amenities` llega como `WIFI,PARQUEADERO` o repetido (`amenities=WIFI&amenities=PARQUEADERO`). */
const toAmenityList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const items = (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(','));
  const codes = items.map((item) => item.trim().toUpperCase()).filter(Boolean);
  return codes.length > 0 ? [...new Set(codes)] : undefined;
};

export class SearchListingsDto {
  @ApiPropertyOptional({ example: 'Medellín', description: 'Ciudad de destino' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    example: '2026-11-10',
    description: 'Fecha de llegada (YYYY-MM-DD). Si se indica, también se exige la de salida (HU-024 CA3)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de llegada debe tener el formato AAAA-MM-DD' })
  checkIn?: string;

  @ApiPropertyOptional({
    example: '2026-11-13',
    description: 'Fecha de salida (YYYY-MM-DD), posterior a la de llegada (HU-024 CA3, RN-010)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de salida debe tener el formato AAAA-MM-DD' })
  checkOut?: string;

  @ApiPropertyOptional({ example: 2, description: 'Número de huéspedes', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El número de huéspedes debe ser un número entero' })
  @Min(1, { message: 'El número de huéspedes debe ser al menos 1' })
  guests?: number;

  @ApiPropertyOptional({ enum: PropertyType, example: PropertyType.APARTAMENTO, description: 'Tipo de alojamiento (HU-025 CA1)' })
  @IsOptional()
  @IsEnum(PropertyType, { message: 'El tipo de alojamiento no es válido' })
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: 150000, description: 'Precio mínimo por noche en COP, incluido (HU-025 CA1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El precio mínimo debe ser un número' })
  @Min(0, { message: 'El precio mínimo no puede ser negativo' })
  minPrice?: number;

  @ApiPropertyOptional({ example: 300000, description: 'Precio máximo por noche en COP, incluido (HU-025 CA1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El precio máximo debe ser un número' })
  @Min(0, { message: 'El precio máximo no puede ser negativo' })
  maxPrice?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['WIFI', 'PARQUEADERO'],
    description: 'Servicios que debe tener la publicación, todos a la vez (HU-025 CA2). Separados por coma o repetidos.',
  })
  @IsOptional()
  @Transform(toAmenityList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Número de página' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, default: 10, description: 'Elementos por página' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}
