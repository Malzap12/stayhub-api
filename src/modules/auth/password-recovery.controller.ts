import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PasswordRecoveryService } from './password-recovery.service';
import {
  MessageResponseDto,
  RequestPasswordRecoveryDto,
  ResetPasswordDto,
  SimulatedMailDto,
} from './dto/password-recovery.dto';
import { Public } from '../../common/decorators/roles.decorator';

@ApiTags('Autenticación (Auth)')
@Public()
@Controller('auth/password-recovery')
export class PasswordRecoveryController {
  constructor(private readonly passwordRecoveryService: PasswordRecoveryService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar recuperación de contraseña · HU-004 (CA1, CA4)',
    description:
      'Genera un token de un solo uso con vencimiento y lo deja en el buzón simulado. Responde el mismo mensaje exista o no el correo.',
  })
  @ApiResponse({ status: 200, description: 'Confirmación genérica (CA4)', type: MessageResponseDto })
  requestRecovery(@Body() dto: RequestPasswordRecoveryDto): MessageResponseDto {
    return this.passwordRecoveryService.requestRecovery(dto.email);
  }

  @Get('mailbox')
  @ApiOperation({
    summary: 'Consultar el buzón simulado · HU-004 (CA1)',
    description: 'Muestra los mensajes de recuperación enviados a un correo. Sustituye al correo real (AMB-33, SUP-11).',
  })
  @ApiQuery({ name: 'email', example: 'usuario@stayhub.com' })
  @ApiResponse({ status: 200, description: 'Mensajes del buzón simulado', type: [SimulatedMailDto] })
  getMailbox(@Query('email') email: string): SimulatedMailDto[] {
    return this.passwordRecoveryService.getMailbox(email);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Definir nueva contraseña con el token · HU-004 (CA2, CA3)',
    description:
      'Actualiza la contraseña si el token es vigente y la clave cumple la política; luego invalida el token. Un token vencido o usado se rechaza con canRequestNewToken = true.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada y token invalidado (CA2)', type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Token vencido, usado o inválido (CA3), o contraseña fuera de política' })
  resetPassword(@Body() dto: ResetPasswordDto): MessageResponseDto {
    return this.passwordRecoveryService.resetPassword(dto.token, dto.newPassword);
  }
}
