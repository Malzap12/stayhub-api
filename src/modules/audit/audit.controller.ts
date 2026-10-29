import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditEventDto, AuditEventsQueryDto } from './dto/audit-event.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import type { ActiveSession } from '../auth/auth.service';

@ApiTags('Auditoría (Audit)')
@ApiBearerAuth()
@Roles(Role.ADMINISTRADOR)
@Controller('audit/events')
export class AuditController {
  static readonly APPEND_ONLY_MESSAGE =
    'La bitácora de auditoría es de solo inserción: los eventos no se pueden modificar ni eliminar';

  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar eventos de auditoría · HU-060 (CA2), HU-061 (CA1, CA3)',
    description:
      'Retorna los eventos registrados (actor, acción, entidad, fecha y hora, resultado), incluidos los eventos de exportación (HU-060 CA2) y los fallidos. Exclusivo del rol ADMINISTRADOR. RF-078, RF-080, RN-027.',
  })
  @ApiResponse({ status: 200, description: 'Eventos de auditoría', type: [AuditEventDto] })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Requiere rol ADMINISTRADOR' })
  findAll(@Query() filters: AuditEventsQueryDto): AuditEventDto[] {
    return this.auditService.findAll(filters);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Intentar reemplazar un evento · HU-061 (CA2)', description: 'Rechazado: la auditoría es de solo inserción.' })
  @ApiParam({ name: 'id', description: 'ID del evento de auditoría' })
  @ApiResponse({ status: 405, description: 'La bitácora no admite modificaciones (CA2)' })
  replace(@Param('id') id: string, @CurrentUser() user?: ActiveSession): never {
    return this.rejectMutation(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Intentar modificar un evento · HU-061 (CA2)', description: 'Rechazado: la auditoría es de solo inserción.' })
  @ApiParam({ name: 'id', description: 'ID del evento de auditoría' })
  @ApiResponse({ status: 405, description: 'La bitácora no admite modificaciones (CA2)' })
  update(@Param('id') id: string, @CurrentUser() user?: ActiveSession): never {
    return this.rejectMutation(id, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Intentar eliminar un evento · HU-061 (CA2)', description: 'Rechazado: la auditoría es de solo inserción.' })
  @ApiParam({ name: 'id', description: 'ID del evento de auditoría' })
  @ApiResponse({ status: 405, description: 'La bitácora no admite eliminaciones (CA2)' })
  remove(@Param('id') id: string, @CurrentUser() user?: ActiveSession): never {
    return this.rejectMutation(id, user);
  }

  private rejectMutation(id: string, user?: ActiveSession): never {
    this.auditService.record({
      actor: user?.email,
      action: AuditAction.AUDIT_TAMPER_ATTEMPT,
      entity: 'AuditEvent',
      entityId: id,
      result: AuditResult.FALLIDO,
      detail: AuditController.APPEND_ONLY_MESSAGE,
    });
    throw new HttpException(AuditController.APPEND_ONLY_MESSAGE, HttpStatus.METHOD_NOT_ALLOWED);
  }
}
