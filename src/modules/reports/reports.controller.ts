import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ReportsService } from './reports.service';
import { DashboardDto } from './dto/dashboard.dto';

@ApiTags('Reportes (Reports)')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ver los indicadores del negocio · HU-056 (CA1, CA2, CA3)',
    description:
      'Usuarios por rol, publicaciones ACTIVAS, reservas por estado, ingresos estimados (valor y tarifa de servicio de las reservas CONFIRMADAS y COMPLETADAS, en COP) y las 5 ciudades con más reservas CONFIRMADAS y COMPLETADAS (CA1). Los valores coinciden con una consulta directa a la base de datos (CA2). Exclusivo para ADMINISTRADOR (CA3). RF-074, RN-026.',
  })
  @ApiResponse({ status: 200, description: 'Indicadores del marketplace (CA1)', type: DashboardDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado: requiere rol ADMINISTRADOR (CA3)' })
  getDashboard(): DashboardDto {
    return this.reportsService.getDashboard();
  }
}
