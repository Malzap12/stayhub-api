import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** HU-036 CA2 · Motivo opcional con que el anfitrión rechaza una solicitud; se le muestra al huésped. */
export class RejectRequestDto {
  @ApiPropertyOptional({ example: 'Esas fechas ya las tengo comprometidas.', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'El motivo admite máximo 300 caracteres' })
  reason?: string;
}

/** HU-036 · Decisión del anfitrión sobre una solicitud de reserva. */
export class HostDecisionDto {
  @ApiProperty({ enum: ['ACEPTADA', 'RECHAZADA'], example: 'RECHAZADA' })
  decision: 'ACEPTADA' | 'RECHAZADA';

  @ApiProperty({ example: 'anfitrion@stayhub.com' })
  decidedBy: string;

  @ApiProperty({ example: '2026-11-03T15:00:00.000Z' })
  decidedAt: string;

  @ApiPropertyOptional({ example: 'Esas fechas ya las tengo comprometidas.' })
  reason?: string;
}
