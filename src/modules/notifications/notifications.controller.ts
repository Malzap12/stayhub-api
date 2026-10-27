import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { NotificationDto, NotificationsSummaryDto } from './dto/notification.dto';

@ApiTags('Notificaciones (HU-043)')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Mis notificaciones · HU-043 (CA1, CA2, CA3)',
    description: 'Notificaciones dentro de la plataforma del usuario de la sesión, de la más reciente a la más antigua, con el total sin leer.',
  })
  @ApiQuery({ name: 'unread', required: false, description: 'true para ver solo las no leídas' })
  @ApiResponse({ status: 200, type: NotificationsSummaryDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  findMine(@CurrentUser() user: ActiveSession, @Query('unread') unread?: string): NotificationsSummaryDto {
    const recipient = { userId: user?.userId, email: user?.email };
    return {
      data: this.notificationsService.findMine(recipient, unread === 'true'),
      unread: this.notificationsService.findMine(recipient, true).length,
    };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({ summary: 'Marcar todas mis notificaciones como leídas · HU-043 (CA3)' })
  @ApiResponse({ status: 200, description: 'Cantidad marcada como leída' })
  markAllAsRead(@CurrentUser() user: ActiveSession): { updated: number } {
    return { updated: this.notificationsService.markAllAsRead({ userId: user?.userId, email: user?.email }) };
  }

  @Patch(':id/read')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({ summary: 'Marcar una notificación como leída · HU-043 (CA3)' })
  @ApiParam({ name: 'id', description: 'ID de la notificación' })
  @ApiResponse({ status: 200, type: NotificationDto })
  @ApiResponse({ status: 404, description: 'No existe o es de otro usuario' })
  markAsRead(@Param('id') id: string, @CurrentUser() user: ActiveSession): NotificationDto {
    return this.notificationsService.markAsRead(id, { userId: user?.userId, email: user?.email });
  }
}
