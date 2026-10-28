import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** HU-047 · Calificar y reseñar mi estancia (CA1 · RF-063, AMB-21): calificación de 1 a 5 y comentario. */
export class CreateReviewDto {
  @ApiProperty({ example: 'booking-1a45f83e-c29e-4831-85b7-948450e066fc', description: 'Reserva COMPLETADA que se reseña' })
  @IsString({ message: 'Indica la reserva que quieres reseñar' })
  @IsNotEmpty({ message: 'Indica la reserva que quieres reseñar' })
  bookingId: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5, description: 'Calificación en estrellas, entera de 1 a 5' })
  @Type(() => Number)
  @IsInt({ message: 'La calificación debe ser un número entero de 1 a 5' })
  @Min(1, { message: 'La calificación mínima es 1' })
  @Max(5, { message: 'La calificación máxima es 5' })
  rating: number;

  @ApiProperty({ example: 'Excelente ubicación y el anfitrión muy atento.', minLength: 3, maxLength: 2000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El comentario debe ser un texto' })
  @IsNotEmpty({ message: 'Escribe un comentario sobre tu estancia' })
  @MinLength(3, { message: 'El comentario debe tener al menos 3 caracteres' })
  @MaxLength(2000, { message: 'El comentario admite máximo 2000 caracteres' })
  comment: string;
}
