import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
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
}

export class AuditEventsQueryDto {
  @ApiPropertyOptional({ example: 'admin@inversioneslr.com' })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ example: 'Booking' })
  @IsOptional()
  @IsString()
  entity?: string;

  @ApiPropertyOptional({ enum: AuditResult })
  @IsOptional()
  @IsEnum(AuditResult)
  result?: AuditResult;
}
