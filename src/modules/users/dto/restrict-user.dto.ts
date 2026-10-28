import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RestrictUserDto {
  @ApiProperty({
    example: 'Incumplimiento de políticas de la plataforma',
    description: 'Motivo obligatorio de la restricción del usuario',
  })
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres' })
  reason: string;
}

export class RestrictUserResponseDto {
  @ApiProperty({ description: 'ID del usuario restringido' })
  userId: string;

  @ApiProperty({ description: 'Correo del usuario' })
  email: string;

  @ApiProperty({ description: 'Estado resultante de la cuenta', example: 'RESTRINGIDA' })
  status: 'RESTRINGIDA';

  @ApiProperty({ description: 'Motivo de la restricción' })
  restrictionReason: string;

  @ApiProperty({ description: 'IDs de publicaciones activas que pasaron a PAUSADA', type: [String] })
  pausedListings: string[];

  @ApiProperty({ description: 'Códigos de reservas futuras que pasaron a EN_REVISION', type: [String] })
  bookingsUnderReview: string[];

  @ApiProperty({ description: 'Mensaje descriptivo del resultado' })
  message: string;
}

export class UnrestrictUserResponseDto {
  @ApiProperty({ description: 'ID del usuario habilitado' })
  userId: string;

  @ApiProperty({ description: 'Correo del usuario' })
  email: string;

  @ApiProperty({ description: 'Estado resultante de la cuenta', example: 'ACTIVA' })
  status: 'ACTIVA';

  @ApiProperty({ description: 'Mensaje descriptivo del resultado' })
  message: string;
}
