import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

/** Teléfono con indicativo opcional: 7 a 15 dígitos separados por espacios o guiones. */
export const PHONE_REGEX = /^\+?\d(?:[\s-]?\d){6,14}$/;

export class LoginDto {
  @ApiProperty({ example: 'usuario@stayhub.com', description: 'Correo electrónico del usuario' })
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @ApiProperty({ example: 'Password123', description: 'Contraseña del usuario', minLength: 8 })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Miguel Ángel Alza', description: 'Nombre completo del usuario' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  name: string;

  @ApiProperty({ example: 'miguel@stayhub.com', description: 'Correo electrónico único' })
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @ApiProperty({
    example: 'Password123',
    description: 'Contraseña de al menos 8 caracteres que combine letras y números (CA3)',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'La contraseña debe tener al menos 8 caracteres y combinar letras y números',
  })
  password: string;

  @ApiPropertyOptional({ example: '+57 300 123 4567', description: 'Teléfono de contacto (opcional · HU-006)' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Ingresa un teléfono válido: solo números, espacios o guiones (7 a 15 dígitos)' })
  phone?: string;

  @ApiProperty({
    enum: [Role.HUESPED, Role.ANFITRION],
    example: Role.HUESPED,
    description: 'Rol público asignable en el registro: HUESPED o ANFITRION (CA4)',
  })
  @IsIn([Role.HUESPED, Role.ANFITRION], {
    message: 'Solo puedes registrarte con el rol HUESPED o ANFITRION',
  })
  role: Role.HUESPED | Role.ANFITRION;
}

export class RegisteredUserDto {
  @ApiProperty({ example: 'user-1' })
  id: string;

  @ApiProperty({ example: 'Miguel Ángel Alza' })
  name: string;

  @ApiProperty({ example: 'miguel@stayhub.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.HUESPED })
  role: Role;

  @ApiProperty({ example: 'ACTIVA', description: 'Estado de la cuenta' })
  status: 'ACTIVA' | 'DESACTIVADA' | 'RESTRINGIDA';

  @ApiProperty()
  createdAt: Date;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'Inicio de sesión exitoso' })
  message: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token: string;

  @ApiProperty({ example: 60, description: 'Tiempo de expiración por inactividad en minutos (RNF-003)' })
  expiresInMinutes: number;

  @ApiProperty({ type: () => RegisteredUserDto })
  user: RegisteredUserDto;
}

/** HU-009 CA2 · Confirmar la reactivación con el token entregado al iniciar sesión. */
export class ReactivateAccountDto {
  @ApiProperty({
    example: '3f9c2a7d1e5b4c8a9f0e1d2c3b4a5968',
    description: 'Token de un solo uso que devuelve el inicio de sesión de una cuenta DESACTIVADA (vence en 10 minutos)',
  })
  @IsString({ message: 'El token de reactivación debe ser un texto' })
  @IsNotEmpty({ message: 'Falta el token de reactivación' })
  reactivationToken: string;
}

/** HU-009 CA1 · Respuesta 403 del inicio de sesión con una cuenta DESACTIVADA y credenciales correctas. */
export class DeactivatedLoginDto {
  @ApiProperty({ example: 403 })
  statusCode: number;

  @ApiProperty({ example: 'CUENTA_DESACTIVADA' })
  reason: string;

  @ApiProperty({ example: 'Tu cuenta está desactivada. ¿Quieres reactivarla? Tu historial se conserva.' })
  message: string;

  @ApiProperty({ example: '3f9c2a7d1e5b4c8a9f0e1d2c3b4a5968', description: 'Token para confirmar la reactivación (un solo uso)' })
  reactivationToken: string;

  @ApiProperty({ example: 10 })
  reactivationExpiresInMinutes: number;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'Cuenta creada exitosamente' })
  message: string;

  @ApiProperty({ type: () => RegisteredUserDto })
  user: RegisteredUserDto;
}

export class LogoutDto {
  @ApiPropertyOptional({ example: 'jwt-user-1-HUESPED', description: 'Token de sesión a invalidar (CA4)' })
  @IsOptional()
  @IsString()
  token?: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: 'Sesión cerrada e invalidada correctamente' })
  message: string;
}
