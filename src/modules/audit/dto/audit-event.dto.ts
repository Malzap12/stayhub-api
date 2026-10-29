import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuditAction, AuditResult } from '../../../common/enums/audit.enum';

export class AuditEventDto {
  @ApiProperty({ example: '3f1c2b4e-8a1d-4c55-9f0e-2b7a1c9d0e11' })
  id: string;

  @ApiProperty({ example: 'admin@inversioneslr.com', description: 'Quién ejecutó la acción (CA1)' })
  actor: string;

  @ApiProperty({ enum: AuditAction, example: AuditAction.LOGIN, description: 'Acción ejecutada (CA1)' })
  action: AuditAction;

  @ApiProperty({ example: 'AuthSession', description: 'Entidad afectada (CA1)' })
  entity: string;

  @ApiPropertyOptional({ example: 'mock-listing-uuid-1', description: 'Identificador de la entidad afectada' })
  entityId?: string;

  @ApiProperty({ example: '2026-10-19T21:30:00.000Z', description: 'Fecha y hora del evento (CA1)' })
  occurredAt: string;

  @ApiProperty({ enum: AuditResult, example: AuditResult.EXITOSO, description: 'Resultado de la acción (CA1, CA3)' })
  result: AuditResult;

  @ApiPropertyOptional({ example: 'Correo electrónico o contraseña incorrectos' })
  detail?: string;

  @ApiPropertyOptional({ example: { report: 'reservas', format: 'xlsx', filters: { status: 'CONFIRMADA' } }, description: 'Metadatos estructurados del evento (HU-060)' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class AuditEventsQueryDto {
  @ApiPropertyOptional({ example: 'admin@inversioneslr.com', description: 'Usuario que ejecutó la acción; acepta parte del correo (HU-054 CA2)' })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional({ enum: AuditAction, description: 'Tipo de evento (HU-054 CA2)' })
  @IsOptional()
  @IsEnum(AuditAction, { message: 'El tipo de evento no es válido' })
  action?: AuditAction;

  @ApiPropertyOptional({ example: 'Booking', description: 'Entidad afectada (HU-054 CA2)' })
  @IsOptional()
  @IsString()
  entity?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Desde esta fecha, incluida, en hora de Bogotá (HU-054 CA2)' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha inicial debe tener el formato AAAA-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Hasta esta fecha, incluida, en hora de Bogotá (HU-054 CA2)' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha final debe tener el formato AAAA-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, description: 'Número de página (por defecto 1 · HU-054 CA1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero' })
  @Min(1, { message: 'La página debe ser al menos 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, description: 'Eventos por página (por defecto 20, máx. 100 · HU-054 CA1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El tamaño de página debe ser un número entero' })
  @Min(1, { message: 'El tamaño de página debe ser al menos 1' })
  @Max(100, { message: 'El tamaño de página no puede superar 100' })
  limit?: number;

  @ApiPropertyOptional({ enum: AuditResult })
  @IsOptional()
  @IsEnum(AuditResult)
  result?: AuditResult;
}

export class AuditEventsPageDto {
  @ApiProperty({ type: [AuditEventDto], description: 'Eventos de la página, del más reciente al más antiguo (HU-054 CA1)' })
  data: AuditEventDto[];

  @ApiProperty({ example: 1, description: 'Página actual' })
  page: number;

  @ApiProperty({ example: 20, description: 'Eventos por página' })
  limit: number;

  @ApiProperty({ example: 57, description: 'Total de eventos que cumplen los filtros' })
  total: number;

  @ApiProperty({ example: 3, description: 'Total de páginas' })
  totalPages: number;
}
