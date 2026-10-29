import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * HU-049 · Ocultar reseñas que incumplen las reglas (CA1, CA2 · RF-066, RN-021).
 */
export class HideReviewDto {
  @ApiProperty({
    example: 'Lenguaje ofensivo o difamatorio que incumple las normas de la comunidad',
    description: 'Motivo por el cual se oculta la reseña (CA1, CA2 · RF-066, RN-021)',
  })
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El motivo es obligatorio para ocultar la reseña' })
  @MinLength(5, { message: 'El motivo debe contener al menos 5 caracteres' })
  reason: string;
}
