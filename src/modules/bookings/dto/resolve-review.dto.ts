import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** HU-052 · Decisión del administrador sobre una reserva EN_REVISION. */
export enum ReviewDecision {
  /** CA1: la reserva vuelve a CONFIRMADA. */
  MANTENER = 'MANTENER',
  /** CA2: la reserva pasa a CANCELADA con devolución simulada del 100 % y se liberan sus noches. */
  CANCELAR = 'CANCELAR',
}

export class ResolveReviewDto {
  @ApiProperty({ enum: ReviewDecision, example: ReviewDecision.MANTENER, description: 'Mantener o cancelar la reserva (HU-052 CA1, CA2)' })
  @IsEnum(ReviewDecision, { message: 'La decisión debe ser MANTENER o CANCELAR' })
  decision: ReviewDecision;

  @ApiPropertyOptional({ example: 'El anfitrión corrigió las fotografías y el alojamiento es el anunciado', maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'La nota debe ser un texto' })
  @MaxLength(500, { message: 'La nota admite máximo 500 caracteres' })
  note?: string;
}
