import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

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

  @ApiProperty({ enum: [Role.HUESPED, Role.ANFITRION], example: Role.HUESPED })
  role: Role;

  @ApiProperty({ example: 'ACTIVA', description: 'Estado inicial de la cuenta (CA1)' })
  status: 'ACTIVA' | 'DESACTIVADA' | 'RESTRINGIDA';

  @ApiProperty()
  createdAt: Date;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'Login exitoso' })
  message: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token: string;

  @ApiProperty({ type: () => RegisteredUserDto })
  user?: RegisteredUserDto;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'Cuenta creada exitosamente' })
  message: string;

  @ApiProperty({ type: () => RegisteredUserDto })
  user: RegisteredUserDto;
}
