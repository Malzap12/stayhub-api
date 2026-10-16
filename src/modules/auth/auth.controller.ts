import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, LoginResponseDto, RegisterResponseDto } from './dto/auth.dto';

@ApiTags('Autenticación (Auth)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión y obtener JWT', description: 'Valida credenciales del usuario y retorna un token JWT.' })
  @ApiResponse({ status: 200, description: 'Inicio de sesión exitoso', type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'Credenciales con formato inválido' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  login(@Body() credentials: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(credentials);
  }

  @Post('register')
  @ApiOperation({
    summary: 'Registrar nuevo usuario (Huésped o Anfitrión) · HU-001',
    description: 'Crea una cuenta ACTIVA con rol HUESPED o ANFITRION, validando correo único y contraseña segura (mínimo 8 caracteres con letras y números).',
  })
  @ApiResponse({ status: 201, description: 'Cuenta ACTIVA creada exitosamente (CA1)', type: RegisterResponseDto })
  @ApiResponse({ status: 400, description: 'Contraseña débil (<8 caracteres o sin letras y números) o datos inválidos (CA3)' })
  @ApiResponse({ status: 403, description: 'Rol ADMINISTRADOR no permitido en registro público (CA4)' })
  @ApiResponse({ status: 409, description: 'El correo electrónico ya está en uso (CA2)' })
  register(@Body() userData: RegisterDto): Promise<RegisterResponseDto> {
    return this.authService.register(userData);
  }
}
