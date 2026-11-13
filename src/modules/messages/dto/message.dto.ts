import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export type MessageSenderRole = 'HUESPED' | 'ANFITRION';

/** Registro interno de una conversación única por (guest, listing). */
export interface StoredConversation {
  id: string;
  listingId: string;
  listingTitle: string;
  listingCity?: string;
  guestId: string;
  guestEmail: string;
  guestName: string;
  hostId: string;
  hostEmail?: string;
  hostName: string;
  createdAt: Date;
  updatedAt: Date;
}

export class StartConversationDto {
  @ApiPropertyOptional({ example: 'demo-bogota-chapinero', description: 'ID del alojamiento (requerido para huésped)' })
  @IsOptional()
  @IsString()
  listingId?: string;

  @ApiPropertyOptional({ example: 'mock-booking-uuid-1', description: 'ID de la reserva (opcional para anfitrión desde detalle de reserva)' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ example: 'guest-uuid-1', description: 'ID o correo del huésped (anfitrión cuando escribe por publicación)' })
  @IsOptional()
  @IsString()
  guestId?: string;

  @ApiProperty({ example: 'Hola, ¿el alojamiento cuenta con parqueadero cubierto?', description: 'Texto del mensaje (1 a 1000 caracteres)' })
  @IsString({ message: 'El mensaje debe ser texto.' })
  content: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'Sí, contamos con un parqueadero privado cubierto.', description: 'Texto del mensaje (1 a 1000 caracteres)' })
  @IsString({ message: 'El mensaje debe ser texto.' })
  content: string;
}

export class MessageDto {
  @ApiProperty({ example: 'msg-6f1c2a9e' })
  id: string;

  @ApiProperty({ example: 'conv-6f1c2a9e' })
  conversationId: string;

  @ApiProperty({ example: 'user-uuid-123' })
  senderId: string;

  @ApiProperty({ enum: ['HUESPED', 'ANFITRION'], example: 'HUESPED' })
  senderRole: MessageSenderRole;

  @ApiProperty({ example: 'Laura Gómez' })
  senderName: string;

  @ApiProperty({ example: 'Hola, ¿a qué hora es el check-in?' })
  content: string;

  @ApiProperty({ example: '2026-11-12T18:30:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({ example: '2026-11-12T18:32:00.000Z' })
  readAt?: Date;
}

export class LastMessagePreviewDto {
  @ApiProperty({ example: 'Hola, ¿a qué hora es el check-in?' })
  content: string;

  @ApiProperty({ example: '2026-11-12T18:30:00.000Z' })
  createdAt: Date;

  @ApiProperty({ enum: ['HUESPED', 'ANFITRION'], example: 'HUESPED' })
  senderRole: MessageSenderRole;
}

/** RNF-025: Solo expone nombres, nunca correo electrónico ni teléfono. */
export class ConversationSummaryDto {
  @ApiProperty({ example: 'conv-6f1c2a9e' })
  id: string;

  @ApiProperty({ example: 'demo-bogota-chapinero' })
  listingId: string;

  @ApiProperty({ example: 'Apartamento en Chapinero Alto' })
  listingTitle: string;

  @ApiPropertyOptional({ example: 'Bogotá' })
  listingCity?: string;

  @ApiProperty({ example: 'user-guest-1' })
  guestId: string;

  @ApiProperty({ example: 'Laura Gómez' })
  guestName: string;

  @ApiProperty({ example: 'user-host-1' })
  hostId: string;

  @ApiProperty({ example: 'Carlos Anfitrión' })
  hostName: string;

  @ApiProperty({ example: 'Carlos Anfitrión', description: 'Nombre de la otra parte en la conversación (sin correo ni teléfono)' })
  counterpartName: string;

  @ApiPropertyOptional({ type: LastMessagePreviewDto })
  lastMessage?: LastMessagePreviewDto;

  @ApiProperty({ example: 2 })
  unreadCount: number;

  @ApiProperty({ example: '2026-11-12T18:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-12T18:30:00.000Z' })
  updatedAt: Date;
}

export class ConversationsPageDto {
  @ApiProperty({ type: [ConversationSummaryDto] })
  data: ConversationSummaryDto[];

  @ApiProperty({ example: 1 })
  unreadConversations: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class PaginatedMessagesDto {
  @ApiProperty({ type: [MessageDto] })
  data: MessageDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class ConversationDetailDto {
  @ApiProperty({ type: ConversationSummaryDto })
  conversation: ConversationSummaryDto;

  @ApiProperty({ type: PaginatedMessagesDto })
  messages: PaginatedMessagesDto;
}

export class UnreadConversationsCountDto {
  @ApiProperty({ example: 2 })
  unreadConversations: number;

  @ApiProperty({ example: 4 })
  unreadMessages: number;
}
