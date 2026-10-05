import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesión y obtener JWT' })
  login(@Body() credentials: any) {
    return this.authService.login(credentials);
  }

  @Post('register')
  @ApiOperation({ summary: 'Registrar nuevo usuario (Huésped o Anfitrión)' })
  register(@Body() userData: any) {
    return this.authService.register(userData);
  }
}
