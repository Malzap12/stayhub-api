import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AuthService, type ActiveSession, type UserAccount } from '../auth/auth.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import {
  ConversationDetailDto,
  ConversationSummaryDto,
  ConversationsPageDto,
  MessageDto,
  MessageSenderRole,
  SendMessageDto,
  StartConversationDto,
  StoredConversation,
  UnreadConversationsCountDto,
} from './dto/message.dto';

export const MAX_MESSAGE_LENGTH = 1000;
export const DEFAULT_CONVERSATIONS_LIMIT = 10;
export const DEFAULT_MESSAGES_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

/**
 * HU-070 · Conversar por mensajes entre huésped y anfitrión (EP-18).
 * - CA1/CA2: una conversación única por (huésped, publicación); el anfitrión solo escribe si existe conversación o reserva.
 * - CA3/CA4/CA5: bandeja y mensajes paginados (lo más reciente primero), marcado como leído y notificación única mientras haya pendientes.
 * - CA6/CA7/CA8: texto 1..1000 caracteres sin vacío, 404 para terceros y administradores, bloqueo si la contraparte está restringida o desactivada.
 */
@Injectable()
export class MessagesService implements OnModuleInit {
  private conversations: StoredConversation[] = [];
  private messages: MessageDto[] = [];

  constructor(
    @Optional() private readonly listingsService?: ListingsService,
    @Optional() private readonly bookingsService?: BookingsService,
    @Optional() private readonly authService?: AuthService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly persistence?: StatePersistenceService,
  ) {}

  onModuleInit(): void {
    this.persistence?.register('messages', {
      dump: () => ({ conversations: this.conversations, messages: this.messages }),
      restore: (data) => {
        const state = data as { conversations?: StoredConversation[]; messages?: MessageDto[] } | null;
        this.conversations = state?.conversations ?? [];
        this.messages = state?.messages ?? [];
      },
    });
  }

  /** CA6: rechaza mensajes vacíos, solo espacios o mayores a 1000 caracteres. */
  validateContent(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new BadRequestException('El mensaje debe ser texto válido.');
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('El mensaje no puede estar vacío ni contener solo espacios.');
    }
    if (raw.length > MAX_MESSAGE_LENGTH || trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.`);
    }
    return trimmed;
  }

  /** CA1/CA2: inicia o reutiliza la conversación única por (huésped, publicación) y guarda el mensaje. */
  startOrSendMessage(dto: StartConversationDto, user: ActiveSession): ConversationDetailDto {
    this.assertNotAdmin(user);
    const content = this.validateContent(dto?.content);

    if (user.role === Role.HUESPED) {
      return this.sendAsGuest(dto, content, user);
    }
    if (user.role === Role.ANFITRION) {
      return this.sendAsHost(dto, content, user);
    }
    throw new NotFoundException('Conversación no encontrada');
  }

  /** CA1/CA2/CA7/CA8: envía un mensaje dentro de una conversación abierta. */
  sendMessageInConversation(
    conversationId: string,
    dto: SendMessageDto,
    user: ActiveSession,
  ): ConversationDetailDto {
    const conversation = this.findAuthorizedConversation(conversationId, user);
    const content = this.validateContent(dto?.content);
    const callerRole = this.callerRoleOf(conversation, user);

    this.assertCounterpartCanReceiveForCaller(conversation, callerRole);
    this.appendMessage(conversation, callerRole, user, content);
    return this.buildDetail(conversation, callerRole, { page: 1, limit: DEFAULT_MESSAGES_LIMIT });
  }

  /** CA3/CA4/CA7: abre una conversación, marca los mensajes entrantes como leídos y pagina lo más reciente primero. */
  getConversation(
    conversationId: string,
    user: ActiveSession,
    options: { page?: number; limit?: number } = {},
  ): ConversationDetailDto {
    const conversation = this.findAuthorizedConversation(conversationId, user);
    const callerRole = this.callerRoleOf(conversation, user);
    this.markIncomingAsRead(conversation.id, callerRole);
    return this.buildDetail(conversation, callerRole, options);
  }

  /** CA4/CA7: marca como leídos los mensajes pendientes de la conversación sin revelar conversaciones ajenas. */
  markConversationAsRead(
    conversationId: string,
    user: ActiveSession,
  ): { updated: number; unreadConversations: number } {
    const conversation = this.findAuthorizedConversation(conversationId, user);
    const callerRole = this.callerRoleOf(conversation, user);
    const updated = this.markIncomingAsRead(conversation.id, callerRole);
    return {
      updated,
      unreadConversations: this.countUnreadConversations(user),
    };
  }

  /** CA3/CA4/CA7: bandeja del huésped o anfitrión ordenada por actividad más reciente y paginada. */
  listMyConversations(
    user: ActiveSession,
    options: { page?: number; limit?: number } = {},
  ): ConversationsPageDto {
    this.assertNotAdmin(user);
    const mine = this.conversations
      .filter((conv) => this.isParticipant(conv, user))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const { page, limit } = this.normalizePagination(options.page, options.limit, DEFAULT_CONVERSATIONS_LIMIT);
    const total = mine.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    const summaries = mine.map((conv) => this.toSummary(conv, this.callerRoleOf(conv, user)));
    const unreadConversations = summaries.filter((item) => item.unreadCount > 0).length;

    return {
      data: summaries.slice(start, start + limit),
      unreadConversations,
      page: safePage,
      limit,
      total,
      totalPages,
    };
  }

  /** CA4: contador de conversaciones y mensajes sin leer del usuario autenticado. */
  getUnreadCount(user: ActiveSession): UnreadConversationsCountDto {
    if (!user || user.role === Role.ADMINISTRADOR) {
      return { unreadConversations: 0, unreadMessages: 0 };
    }
    const mine = this.conversations.filter((conv) => this.isParticipant(conv, user));
    let unreadConversations = 0;
    let unreadMessages = 0;
    for (const conv of mine) {
      const role = this.callerRoleOf(conv, user);
      const count = this.countUnreadInConversation(conv.id, role);
      if (count > 0) {
        unreadConversations += 1;
        unreadMessages += count;
      }
    }
    return { unreadConversations, unreadMessages };
  }

  /** Permite ubicar una conversación existente desde una publicación (huésped) o reserva (anfitrión). */
  findConversationByContext(
    query: { listingId?: string; bookingId?: string },
    user: ActiveSession,
  ): { conversationId: string } | null {
    this.assertNotAdmin(user);
    if (query.bookingId) {
      const booking = this.bookingsService?.getBookingForMessaging(query.bookingId);
      if (!booking) return null;
      const listing = this.listingsService?.getListing(booking.listingId);
      if (!listing) return null;
      const isHost = user.role === Role.ANFITRION && listing.hostId === user.userId;
      const isGuest =
        user.role === Role.HUESPED &&
        (booking.guestId.toLowerCase() === user.email.toLowerCase() || booking.guestId === user.userId);
      if (!isHost && !isGuest) return null;
      const conv = this.findUniqueConversation(booking.listingId, {
        userId: isGuest ? user.userId : undefined,
        email: booking.guestId,
      });
      return conv ? { conversationId: conv.id } : null;
    }

    if (query.listingId && user.role === Role.HUESPED) {
      const conv = this.findUniqueConversation(query.listingId, {
        userId: user.userId,
        email: user.email,
      });
      return conv ? { conversationId: conv.id } : null;
    }

    return null;
  }

  private sendAsGuest(
    dto: StartConversationDto,
    content: string,
    user: ActiveSession,
  ): ConversationDetailDto {
    let listingId = dto?.listingId?.trim();
    if (!listingId && dto?.bookingId) {
      const booking = this.bookingsService?.getBookingForMessaging(dto.bookingId.trim());
      if (
        !booking ||
        (booking.guestId.toLowerCase() !== user.email.toLowerCase() && booking.guestId !== user.userId)
      ) {
        throw new NotFoundException('Reserva no encontrada');
      }
      listingId = booking.listingId;
    }

    if (!listingId) {
      throw new BadRequestException('Debes indicar el alojamiento para contactar al anfitrión.');
    }

    const listing = this.listingsService?.getListing(listingId);
    if (!listing) {
      throw new NotFoundException('Publicación no encontrada');
    }

    if (listing.hostId === user.userId) {
      throw new BadRequestException('No puedes enviarte mensajes en tu propia publicación.');
    }

    let conversation = this.findUniqueConversation(listing.id, {
      userId: user.userId,
      email: user.email,
    });

    if (!conversation && listing.status !== ListingStatus.ACTIVA) {
      throw new BadRequestException('Solo puedes contactar al anfitrión de un alojamiento activo.');
    }

    const hostAccount = this.resolveHostAccount(listing.hostId);
    this.assertAccountCanReceive(hostAccount, 'anfitrión');

    if (!conversation) {
      const guestAccount = this.resolveAccount(user.userId, user.email);
      const now = new Date();
      conversation = {
        id: `conv-${randomUUID()}`,
        listingId: listing.id,
        listingTitle: listing.title,
        listingCity: listing.city,
        guestId: user.userId,
        guestEmail: user.email.trim().toLowerCase(),
        guestName: guestAccount?.name ?? user.email,
        hostId: listing.hostId ?? hostAccount?.id ?? '',
        hostEmail: hostAccount?.email,
        hostName: hostAccount?.name ?? listing.hostName ?? 'Anfitrión',
        createdAt: now,
        updatedAt: now,
      };
      this.conversations.push(conversation);
    }

    this.appendMessage(conversation, 'HUESPED', user, content);
    return this.buildDetail(conversation, 'HUESPED', { page: 1, limit: DEFAULT_MESSAGES_LIMIT });
  }

  private sendAsHost(
    dto: StartConversationDto,
    content: string,
    user: ActiveSession,
  ): ConversationDetailDto {
    const target = this.resolveHostTarget(dto, user);
    const { listing, guestAccount, guestIdentifier } = target;

    let conversation = this.findUniqueConversation(listing.id, {
      userId: guestAccount?.id,
      email: guestAccount?.email ?? guestIdentifier,
    });

    if (!conversation) {
      const hasBooking = Boolean(
        this.bookingsService?.hasGuestBookingWithHostListing(listing.id, {
          userId: guestAccount?.id ?? guestIdentifier,
          email: guestAccount?.email ?? guestIdentifier,
        }),
      );
      if (!hasBooking) {
        throw new ForbiddenException(
          'No puedes escribir a huéspedes que no te han escrito ni han reservado contigo.',
        );
      }
    }

    this.assertAccountCanReceive(guestAccount, 'huésped');

    if (!conversation) {
      const hostAccount = this.resolveAccount(user.userId, user.email);
      const now = new Date();
      const guestEmail = (guestAccount?.email ?? guestIdentifier).trim().toLowerCase();
      conversation = {
        id: `conv-${randomUUID()}`,
        listingId: listing.id,
        listingTitle: listing.title,
        listingCity: listing.city,
        guestId: guestAccount?.id ?? guestEmail,
        guestEmail,
        guestName: guestAccount?.name ?? 'Huésped',
        hostId: user.userId,
        hostEmail: user.email.trim().toLowerCase(),
        hostName: hostAccount?.name ?? listing.hostName ?? user.email,
        createdAt: now,
        updatedAt: now,
      };
      this.conversations.push(conversation);
    }

    this.appendMessage(conversation, 'ANFITRION', user, content);
    return this.buildDetail(conversation, 'ANFITRION', { page: 1, limit: DEFAULT_MESSAGES_LIMIT });
  }

  private resolveHostTarget(
    dto: StartConversationDto,
    user: ActiveSession,
  ): {
    listing: NonNullable<ReturnType<ListingsService['getListing']>>;
    guestAccount?: UserAccount;
    guestIdentifier: string;
  } {
    if (dto?.bookingId?.trim()) {
      const booking = this.bookingsService?.getBookingForMessaging(dto.bookingId.trim());
      const listing = booking ? this.listingsService?.getListing(booking.listingId) : undefined;
      if (!booking || !listing || listing.hostId !== user.userId) {
        throw new NotFoundException('Reserva no encontrada');
      }
      const guestAccount = this.resolveAccount(booking.guestId, booking.guestId);
      return { listing, guestAccount, guestIdentifier: booking.guestId };
    }

    const listingId = dto?.listingId?.trim();
    const guestId = dto?.guestId?.trim();
    if (!listingId || !guestId) {
      throw new BadRequestException('Debes indicar la reserva o el alojamiento y el huésped.');
    }

    const listing = this.listingsService?.getListing(listingId);
    if (!listing || listing.hostId !== user.userId) {
      throw new NotFoundException('Publicación no encontrada');
    }
    const guestAccount = this.resolveAccount(guestId, guestId);
    return { listing, guestAccount, guestIdentifier: guestId };
  }

  private appendMessage(
    conversation: StoredConversation,
    senderRole: MessageSenderRole,
    user: ActiveSession,
    content: string,
  ): MessageDto {
    const senderAccount = this.resolveAccount(user.userId, user.email);
    const senderName =
      senderAccount?.name ??
      (senderRole === 'HUESPED' ? conversation.guestName : conversation.hostName);

    // CA5: verificar ANTES de insertar si ya hay mensajes sin leer de este remitente para el destinatario.
    const alreadyHasUnreadForRecipient = this.messages.some(
      (m) => m.conversationId === conversation.id && m.senderRole === senderRole && !m.readAt,
    );

    const now = new Date();
    const message: MessageDto = {
      id: `msg-${randomUUID()}`,
      conversationId: conversation.id,
      senderId: user.userId,
      senderRole,
      senderName,
      content,
      createdAt: now,
    };
    this.messages.push(message);
    conversation.updatedAt = now;

    if (!alreadyHasUnreadForRecipient) {
      const recipient =
        senderRole === 'HUESPED'
          ? { userId: conversation.hostId, email: conversation.hostEmail }
          : { userId: conversation.guestId, email: conversation.guestEmail };
      this.notificationsService?.messageReceived({
        conversationId: conversation.id,
        listingTitle: conversation.listingTitle,
        senderName,
        recipient,
      });
    }

    return message;
  }

  private markIncomingAsRead(conversationId: string, callerRole: MessageSenderRole): number {
    const now = new Date();
    let updated = 0;
    for (const msg of this.messages) {
      if (msg.conversationId === conversationId && msg.senderRole !== callerRole && !msg.readAt) {
        msg.readAt = now;
        updated += 1;
      }
    }
    return updated;
  }

  private findAuthorizedConversation(conversationId: string, user: ActiveSession): StoredConversation {
    this.assertNotAdmin(user);
    const conversation = this.conversations.find((item) => item.id === conversationId);
    if (!conversation || !this.isParticipant(conversation, user)) {
      throw new NotFoundException('Conversación no encontrada');
    }
    return conversation;
  }

  private assertNotAdmin(user: ActiveSession): void {
    if (!user || user.role === Role.ADMINISTRADOR) {
      throw new NotFoundException('Conversación no encontrada');
    }
  }

  private isParticipant(conv: StoredConversation, user: ActiveSession): boolean {
    const email = user.email?.trim().toLowerCase();
    const isGuest =
      conv.guestId === user.userId || (Boolean(email) && conv.guestEmail?.toLowerCase() === email);
    const isHost =
      conv.hostId === user.userId || (Boolean(email) && conv.hostEmail?.toLowerCase() === email);
    return isGuest || isHost;
  }

  private callerRoleOf(conv: StoredConversation, user: ActiveSession): MessageSenderRole {
    const email = user.email?.trim().toLowerCase();
    const isHost =
      conv.hostId === user.userId || (Boolean(email) && conv.hostEmail?.toLowerCase() === email);
    return isHost && user.role === Role.ANFITRION ? 'ANFITRION' : isHost && !this.matchesGuest(conv, user) ? 'ANFITRION' : 'HUESPED';
  }

  private matchesGuest(conv: StoredConversation, user: ActiveSession): boolean {
    const email = user.email?.trim().toLowerCase();
    return conv.guestId === user.userId || (Boolean(email) && conv.guestEmail?.toLowerCase() === email);
  }

  private findUniqueConversation(
    listingId: string,
    guest: { userId?: string; email?: string },
  ): StoredConversation | undefined {
    const normalizedEmail = guest.email?.trim().toLowerCase();
    return this.conversations.find(
      (conv) =>
        conv.listingId === listingId &&
        ((Boolean(guest.userId) && conv.guestId === guest.userId) ||
          (Boolean(normalizedEmail) && conv.guestEmail?.toLowerCase() === normalizedEmail) ||
          (Boolean(normalizedEmail) && conv.guestId.toLowerCase() === normalizedEmail)),
    );
  }

  private assertCounterpartCanReceiveForCaller(
    conv: StoredConversation,
    callerRole: MessageSenderRole,
  ): void {
    const counterpartAccount =
      callerRole === 'HUESPED'
        ? this.resolveAccount(conv.hostId, conv.hostEmail)
        : this.resolveAccount(conv.guestId, conv.guestEmail);
    const label = callerRole === 'HUESPED' ? 'anfitrión' : 'huésped';
    this.assertAccountCanReceive(counterpartAccount, label);
  }

  private assertAccountCanReceive(account: UserAccount | undefined, roleLabel: string): void {
    if (!account) return;
    if (account.status === 'RESTRINGIDA') {
      throw new BadRequestException(
        `El ${roleLabel} tiene su cuenta restringida y no puede recibir mensajes en este momento.`,
      );
    }
    if (account.status === 'DESACTIVADA') {
      throw new BadRequestException(
        `El ${roleLabel} tiene su cuenta desactivada y no puede recibir mensajes en este momento.`,
      );
    }
  }

  private resolveHostAccount(hostId?: string): UserAccount | undefined {
    if (!hostId) return undefined;
    return this.resolveAccount(hostId, hostId);
  }

  private resolveAccount(id?: string, email?: string): UserAccount | undefined {
    if (!this.authService) return undefined;
    if (id) {
      const byId = this.authService.findById(id);
      if (byId) return byId;
    }
    if (email) {
      const byEmail = this.authService.findByEmail(email);
      if (byEmail) return byEmail;
    }
    return undefined;
  }

  private countUnreadInConversation(conversationId: string, callerRole: MessageSenderRole): number {
    return this.messages.filter(
      (m) => m.conversationId === conversationId && m.senderRole !== callerRole && !m.readAt,
    ).length;
  }

  private countUnreadConversations(user: ActiveSession): number {
    return this.getUnreadCount(user).unreadConversations;
  }

  private toSummary(conv: StoredConversation, callerRole: MessageSenderRole): ConversationSummaryDto {
    const convMessages = this.messages
      .filter((m) => m.conversationId === conv.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const last = convMessages[0];

    return {
      id: conv.id,
      listingId: conv.listingId,
      listingTitle: conv.listingTitle,
      ...(conv.listingCity ? { listingCity: conv.listingCity } : {}),
      guestId: conv.guestId,
      guestName: conv.guestName,
      hostId: conv.hostId,
      hostName: conv.hostName,
      counterpartName: callerRole === 'HUESPED' ? conv.hostName : conv.guestName,
      ...(last
        ? {
            lastMessage: {
              content: last.content,
              createdAt: last.createdAt,
              senderRole: last.senderRole,
            },
          }
        : {}),
      unreadCount: this.countUnreadInConversation(conv.id, callerRole),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  private buildDetail(
    conv: StoredConversation,
    callerRole: MessageSenderRole,
    options: { page?: number; limit?: number },
  ): ConversationDetailDto {
    const allMessages = this.messages
      .filter((m) => m.conversationId === conv.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const { page, limit } = this.normalizePagination(options.page, options.limit, DEFAULT_MESSAGES_LIMIT);
    const total = allMessages.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    return {
      conversation: this.toSummary(conv, callerRole),
      messages: {
        data: allMessages.slice(start, start + limit),
        page: safePage,
        limit,
        total,
        totalPages,
      },
    };
  }

  private normalizePagination(
    rawPage?: number,
    rawLimit?: number,
    defaultLimit = DEFAULT_CONVERSATIONS_LIMIT,
  ): { page: number; limit: number } {
    const parsedPage = Number(rawPage);
    const parsedLimit = Number(rawLimit);
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.trunc(parsedPage) : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit >= 1
        ? Math.min(MAX_PAGE_LIMIT, Math.trunc(parsedLimit))
        : defaultLimit;
    return { page, limit };
  }
}
