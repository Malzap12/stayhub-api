import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PlatformConfigService } from './platform-config.service';
import { ServiceFeeResponseDto, UpdateServiceFeeDto } from './dto/service-fee.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ActiveSession } from '../auth/auth.service';

@ApiTags('Configuración de Plataforma (Platform)')
@Controller('platform/service-fee')
export class PlatformController {
  constructor(private readonly platformService: PlatformConfigService) {}

  @Get()
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar tarifa de servicio de la plataforma · HU-029',
    description: 'Retorna el porcentaje vigente de la tarifa de servicio. Exclusivo para administradores.',
  })
  @ApiResponse({ status: 200, description: 'Tarifa de servicio actual', type: ServiceFeeResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ADMINISTRADOR)' })
  getServiceFee(): ServiceFeeResponseDto {
    return this.platformService.getServiceFee();
  }

  @Patch()
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Configurar la tarifa de servicio · HU-029 (CA1, CA2, CA3)',
    description:
      'Actualiza el porcentaje de la tarifa de servicio entre 0 % y 30 % (RN-014). Las cotizaciones nuevas usan el nuevo porcentaje (CA1). Las reservas confirmadas conservan su tarifa previa (CA2). Se registra en auditoría el valor anterior y el nuevo (CA3, RN-021).',
  })
  @ApiResponse({ status: 200, description: 'Tarifa de servicio actualizada', type: ServiceFeeResponseDto })
  @ApiResponse({ status: 400, description: 'Porcentaje fuera del rango [0, 30] %' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ADMINISTRADOR)' })
  updateServiceFee(
    @Body() dto: UpdateServiceFeeDto,
    @CurrentUser() user?: ActiveSession,
  ): ServiceFeeResponseDto {
    return this.platformService.updateServiceFee(dto, user?.email);
  }
}
