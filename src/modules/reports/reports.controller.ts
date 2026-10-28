import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ActiveSession } from '../auth/auth.service';
import { ReportExportService } from './report-export.service';
import { EXPORTABLE_REPORTS, ExportReportQueryDto } from './dto/export-report.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ReportsService } from './reports.service';
import { DashboardDto } from './dto/dashboard.dto';

@ApiTags('Reportes (Reports)')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportExportService: ReportExportService,
  ) {}

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

  @Get('export/:report')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Exportar un reporte de gestión a Excel · HU-058 (CA1, CA2)',
    description:
      'Descarga un archivo .xlsx del reporte indicado (usuarios, publicaciones, reservas, ingresos o demanda por ciudad y tipo) con título, fecha de generación, filtros aplicados, encabezados con autofiltro y una fila de totales que coincide con los datos del sistema. Filtros opcionales: from y to (fecha de creación), city y status. Exclusivo para ADMINISTRADOR; la exportación queda en la auditoría. RF-076, RF-077, RN-026.',
  })
  @ApiParam({ name: 'report', enum: EXPORTABLE_REPORTS })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: 'Archivo .xlsx del reporte (CA1)' })
  @ApiResponse({ status: 400, description: 'Filtros inválidos (fechas mal formadas o la inicial posterior a la final)' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado: requiere rol ADMINISTRADOR' })
  @ApiResponse({ status: 404, description: 'El reporte no existe' })
  async exportReport(
    @Param('report') report: string,
    @Query() filters: ExportReportQueryDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user?: ActiveSession,
  ): Promise<StreamableFile> {
    const file = await this.reportExportService.export(report, filters, user?.email);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    return new StreamableFile(file.buffer);
  }
}
