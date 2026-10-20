import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class RequestPasswordRecoveryDto {
  @ApiProperty({ example: 'usuario@stayhub.com', description: 'Correo de la cuenta a recuperar' })
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '9f2c...e1', description: 'Token de un solo uso recibido en el buzón simulado' })
  @IsString()
  @IsNotEmpty({ message: 'El token de recuperación es obligatorio' })
  token: string;

  @ApiProperty({
    example: 'NuevaClave2026',
    description: 'Nueva contraseña: al menos 8 caracteres combinando letras y números',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'La contraseña debe tener al menos 8 caracteres y combinar letras y números',
  })
  newPassword: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Si el correo está registrado, recibirás un enlace de recuperación en tu buzón.' })
  message: string;
}

export class RecoveryRequestResponseDto extends MessageResponseDto {
  @ApiProperty({
    enum: ['EMAIL', 'SIMULATED'],
    example: 'EMAIL',
    description: 'Canal de entrega configurado: correo real (HU-004A) o buzón simulado (HU-004)',
  })
  delivery: 'EMAIL' | 'SIMULATED';
}

export class TokenStatusDto {
  @ApiProperty({ example: true, description: 'Indica si el enlace sigue vigente (HU-004A)' })
  valid: boolean;

  @ApiPropertyOptional({ example: '2026-10-20T04:00:00.000Z' })
  expiresAt?: string;

  @ApiPropertyOptional({ example: 'El enlace de recuperación no es válido, venció o ya fue usado. Solicita uno nuevo.' })
  message?: string;
}

export class SimulatedMailDto {
  @ApiProperty({ example: '0b6f1c2e-6d0a-4a63-9a43-7a0d5c1e2f10' })
  id: string;

  @ApiProperty({ example: 'usuario@stayhub.com' })
  to: string;

  @ApiProperty({ example: 'Recupera tu contraseña · Inversiones LR' })
  subject: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ description: 'Token de un solo uso (CA1)' })
  token: string;

  @ApiProperty({ example: '2026-10-20T04:00:00.000Z', description: 'Vencimiento del token (CA1)' })
  expiresAt: string;

  @ApiProperty({ example: '2026-10-20T03:30:00.000Z' })
  sentAt: string;
}
