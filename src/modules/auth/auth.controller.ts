import { Controller, Post, Get, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  LoginResponseDto,
  ReactivateAccountDto,
  DeactivatedLoginDto,
  RegisterResponseDto,
  LogoutDto,
  LogoutResponseDto,
} from './dto/auth.dto';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Autenticación (Auth)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar sesión y obtener sesión autenticada · HU-002',
    description: 'Valida credenciales contra cuentas ACTIVAS (CA1), retorna mensaje genérico ante fallos (CA2) y bloquea cuentas RESTRINGIDAS (CA3).',
  })
  @ApiResponse({ status: 200, description: 'Inicio de sesión exitoso (CA1)', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Correo electrónico o contraseña incorrectos (CA2)' })
  @ApiResponse({ status: 403, description: 'Cuenta restringida por un administrador (CA3), o cuenta DESACTIVADA: se ofrece reactivarla (HU-009 CA1)', type: DeactivatedLoginDto })
  login(@Body() credentials: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(credentials);
  }

  @Post('reactivate')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivar mi cuenta · HU-009 (CA1, CA2)',
    description:
      'Al iniciar sesión con una cuenta DESACTIVADA y credenciales correctas, el login responde 403 CUENTA_DESACTIVADA con un token de reactivación de un solo uso (CA1). Al confirmar con ese token la cuenta vuelve a ACTIVA, se registra el evento (RN-021) y se abre la sesión. Las publicaciones siguen PAUSADAS hasta que el anfitrión las reactive (CA2).',
  })
  @ApiResponse({ status: 200, description: 'Cuenta reactivada y sesión abierta (CA2)', type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'Token vencido, inválido o ya usado, o la cuenta no está desactivada' })
  reactivate(@Body() dto: ReactivateAccountDto): LoginResponseDto {
    return this.authService.reactivate(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cerrar sesión e invalidar token · HU-002 (CA4)',
    description: 'Invalida la sesión activa del usuario y registra el evento de auditoría (RN-021).',
  })
  @ApiResponse({ status: 200, description: 'Sesión invalidada correctamente (CA4)', type: LogoutResponseDto })
  logout(
    @Headers('authorization') authHeader?: string,
    @Body() logoutDto?: LogoutDto,
  ): Promise<LogoutResponseDto> {
    return this.authService.logout(authHeader || logoutDto?.token);
  }

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Registrar nuevo usuario (Huésped o Anfitrión) · HU-001',
    description: 'Crea una cuenta ACTIVA con rol HUESPED o ANFITRION, validando correo único y contraseña segura.',
  })
  @ApiResponse({ status: 201, description: 'Cuenta ACTIVA creada exitosamente (CA1)', type: RegisterResponseDto })
  @ApiResponse({ status: 400, description: 'Contraseña débil (<8 caracteres o sin letras y números) o datos inválidos (CA3)' })
  @ApiResponse({ status: 403, description: 'Rol ADMINISTRADOR no permitido en registro público (CA4)' })
  @ApiResponse({ status: 409, description: 'El correo electrónico ya está en uso (CA2)' })
  register(@Body() userData: RegisterDto): Promise<RegisterResponseDto> {
    return this.authService.register(userData);
  }

  @Get('admin/audit')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar bitácora de auditoría de seguridad · HU-003 (CA2)',
    description: 'Operación exclusiva del rol ADMINISTRADOR. Cualquier invocación por HUESPED o ANFITRION responde 403 Forbidden.',
  })
  @ApiResponse({ status: 200, description: 'Eventos de auditoría retornados para ADMINISTRADOR' })
  @ApiResponse({ status: 401, description: 'No autenticado (CA1)' })
  @ApiResponse({ status: 403, description: 'Acceso denegado: requiere rol ADMINISTRADOR (CA2)' })
  getAdminAuditEvents() {
    return this.authService.getAuditEvents();
  }
}

