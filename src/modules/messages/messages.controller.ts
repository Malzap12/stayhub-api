import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import {
  ConversationDetailDto,
  ConversationsPageDto,
  SendMessageDto,
  StartConversationDto,
  UnreadConversationsCountDto,
} from './dto/message.dto';
import { MessagesService } from './messages.service';

@ApiTags('Mensajes (HU-070)')
@ApiBearerAuth()
@Controller('conversations')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Bandeja de conversaciones paginada · HU-070 (CA3, CA4, CA7)',
    description: 'Lista las conversaciones propias de la sesión ordenada por el mensaje más reciente primero.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Número de página (por defecto 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Cantidad por página (por defecto 10, máx. 50)' })
  @ApiResponse({ status: 200, type: ConversationsPageDto })
  @ApiResponse({ status: 404, description: 'Sin acceso para este rol' })
  listMine(
    @CurrentUser() user: ActiveSession,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): ConversationsPageDto {
    return this.messagesService.listMyConversations(user, {
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  @Get('unread-count')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Contador de conversaciones y mensajes sin leer · HU-070 (CA4)',
  })
  @ApiResponse({ status: 200, type: UnreadConversationsCountDto })
  getUnreadCount(@CurrentUser() user: ActiveSession): UnreadConversationsCountDto {
    return this.messagesService.getUnreadCount(user);
  }

  @Get('lookup')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Buscar conversación existente por publicación o reserva · HU-070 (CA1, CA2)',
  })
  @ApiQuery({ name: 'listingId', required: false })
  @ApiQuery({ name: 'bookingId', required: false })
  @ApiResponse({ status: 200 })
  lookup(
    @CurrentUser() user: ActiveSession,
    @Query('listingId') listingId?: string,
    @Query('bookingId') bookingId?: string,
  ): { conversationId: string | null } {
    const found = this.messagesService.findConversationByContext({ listingId, bookingId }, user);
    return { conversationId: found?.conversationId ?? null };
  }

  @Get(':id')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Detalle y mensajes de una conversación (marca como leídos) · HU-070 (CA3, CA4, CA7)',
  })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: ConversationDetailDto })
  @ApiResponse({ status: 404, description: 'Conversación no encontrada' })
  getConversation(
    @Param('id') id: string,
    @CurrentUser() user: ActiveSession,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): ConversationDetailDto {
    return this.messagesService.getConversation(id, user, {
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  @Post()
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Iniciar conversación o enviar mensaje por publicación o reserva · HU-070 (CA1, CA2, CA6, CA8)',
  })
  @ApiResponse({ status: 201, type: ConversationDetailDto })
  @ApiResponse({ status: 400, description: 'Mensaje inválido o contraparte restringida/desactivada' })
  @ApiResponse({ status: 403, description: 'Anfitrión sin vínculo previo con el huésped' })
  @ApiResponse({ status: 404, description: 'Publicación, reserva o acceso no disponible' })
  startOrSend(
    @Body() dto: StartConversationDto,
    @CurrentUser() user: ActiveSession,
  ): ConversationDetailDto {
    return this.messagesService.startOrSendMessage(dto, user);
  }

  @Post(':id/messages')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Enviar mensaje en una conversación abierta · HU-070 (CA1, CA2, CA5, CA6, CA7, CA8)',
  })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @ApiResponse({ status: 201, type: ConversationDetailDto })
  @ApiResponse({ status: 400, description: 'Mensaje inválido o contraparte restringida/desactivada' })
  @ApiResponse({ status: 404, description: 'Conversación no encontrada' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: ActiveSession,
  ): ConversationDetailDto {
    return this.messagesService.sendMessageInConversation(id, dto, user);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Marcar como leídos los mensajes pendientes de una conversación · HU-070 (CA4, CA7)',
  })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Conversación no encontrada' })
  markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: ActiveSession,
  ): { updated: number; unreadConversations: number } {
    return this.messagesService.markConversationAsRead(id, user);
  }
}
