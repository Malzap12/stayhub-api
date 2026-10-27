import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** HU-040 · Cancelar mi reserva (CA1 · RF-053): el huésped indica el motivo. */
export class CancelBookingDto {
  @ApiProperty({ example: 'Cambio imprevisto de itinerario', description: 'Motivo de la cancelación', minLength: 3, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El motivo de la cancelación debe ser un texto' })
  @IsNotEmpty({ message: 'Indica el motivo de la cancelación' })
  @MinLength(3, { message: 'El motivo de la cancelación debe tener al menos 3 caracteres' })
  @MaxLength(500, { message: 'El motivo de la cancelación admite máximo 500 caracteres' })
  reason: string;
}
