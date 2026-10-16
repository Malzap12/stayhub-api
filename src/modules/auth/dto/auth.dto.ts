import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

export class LoginDto {
  @ApiProperty({ example: 'usuario@stayhub.com', description: 'Correo electrónico del usuario' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Password123!', description: 'Contraseña del usuario', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Miguel Ángel Alza', description: 'Nombre completo del usuario' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'miguel@stayhub.com', description: 'Correo electrónico único' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Password123!', description: 'Contraseña de acceso', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({
    enum: [Role.HUESPED, Role.ANFITRION],
    example: Role.ANFITRION,
    description: 'Rol público asignable en el registro (CA2: ADMINISTRADOR prohibido en registro público)',
  })
  @IsIn([Role.HUESPED, Role.ANFITRION], {
    message: 'El registro público solo permite los roles HUESPED o ANFITRION',
  })
  role: Role.HUESPED | Role.ANFITRION;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'Login exitoso' })
  message: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token: string;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'Usuario registrado correctamente' })
  message: string;

  @ApiProperty({ type: () => RegisterDto })
  user: RegisterDto;
}
