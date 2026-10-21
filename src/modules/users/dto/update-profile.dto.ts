import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmpty, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PHONE_REGEX } from '../../auth/dto/auth.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Laura Gómez', description: 'Nombre completo (CA1)' })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'El nombre completo no puede quedar vacío' })
  @MaxLength(100, { message: 'El nombre completo admite máximo 100 caracteres' })
  name?: string;

  @ApiPropertyOptional({
    example: '+57 300 123 4567',
    nullable: true,
    type: String,
    description: 'Teléfono de contacto (CA1). Enviar null o "" para quitarlo.',
  })
  @ValidateIf((dto: UpdateProfileDto) => Boolean(dto.phone))
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Ingresa un teléfono válido: solo números, espacios o guiones (7 a 15 dígitos)' })
  phone?: string | null;

  /** CA3: el correo no se edita desde el perfil. */
  @ApiHideProperty()
  @IsEmpty({ message: 'El correo electrónico no se puede editar' })
  email?: never;

  /** CA3: el rol no se edita desde el perfil. */
  @ApiHideProperty()
  @IsEmpty({ message: 'El rol no se puede editar' })
  role?: never;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Password123', description: 'Contraseña actual (CA2)' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria' })
  currentPassword: string;

  @ApiProperty({
    example: 'NuevaClave2026',
    description: 'Nueva contraseña: al menos 8 caracteres que combinen letras y números (CA2)',
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

export class ChangePasswordResponseDto {
  @ApiProperty({ example: 'Contraseña actualizada correctamente' })
  message: string;
}
