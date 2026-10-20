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
  @ApiOperation({ summary: 'Registrar nuevo usuario (Huésped o Anfitrión)', description: 'Registra una nueva cuenta de usuario con su rol respectivo.' })
  @ApiResponse({ status: 201, description: 'Usuario registrado exitosamente', type: RegisterResponseDto })
  @ApiResponse({ status: 400, description: 'Datos de registro inválidos' })
  register(@Body() userData: RegisterDto): Promise<RegisterResponseDto> {
    return this.authService.register(userData);
  }
}
