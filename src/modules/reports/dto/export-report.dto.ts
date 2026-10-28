import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** HU-058 · Reportes de gestión que se exportan a Excel (AMB-23: cinco contenidos). */
export const EXPORTABLE_REPORTS = ['usuarios', 'publicaciones', 'reservas', 'ingresos', 'demanda'] as const;
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** HU-058 CA1 · Filtros opcionales; los aplicados quedan escritos en el archivo. */
export class ExportReportQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Desde esta fecha de creación (AAAA-MM-DD, hora de Colombia), incluida' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha inicial debe tener el formato AAAA-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Hasta esta fecha de creación (AAAA-MM-DD, hora de Colombia), incluida' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha final debe tener el formato AAAA-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ example: 'Medellín', description: 'Ciudad del alojamiento (publicaciones, reservas, ingresos y demanda)' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'CONFIRMADA',
    description: 'Estado: de la cuenta (usuarios), de la publicación (publicaciones) o de la reserva (reservas)',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : undefined))
  @IsString()
  @MaxLength(40)
  status?: string;
}
