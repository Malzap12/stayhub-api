import { Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { NotificationDto, NotificationsSummaryDto, NotificationType } from './dto/notification.dto';

export const DEFAULT_NOTIFICATIONS_LIMIT = 10;
export const MAX_NOTIFICATIONS_LIMIT = 50;

/** Destinatario de una notificación: el ID del usuario, su correo o ambos (las reservas guardan el correo del huésped). */
export interface NotificationRecipient {
  userId?: string;
  email?: string;
}

export interface NotifyInput {
  recipient: NotificationRecipient;
  type: NotificationType;
  message: string;
  entity: NotificationDto['entity'];
  entityId: string;
  bookingCode?: string;
}

/** Datos mínimos de una reserva para notificarla. */
export interface BookingNotice {
  id: string;
  code?: string;
  checkIn: string;
  checkOut: string;
  guestEmail: string;
  hostId?: string;
  listingTitle?: string;
}

/**
 * HU-043 · Recibir notificaciones de los eventos (CA1, CA2, CA3 · RF-059, RN-021).
 * HU-044 · Consultar mis notificaciones (CA1, CA2 · RF-060, RNF-022).
 * Solo notificaciones dentro de la plataforma (AMB-32, SUP-11), guardadas en PostgreSQL.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private notifications: NotificationDto[] = [];

  constructor(@Optional() private readonly persistence?: StatePersistenceService) {}

  onModuleInit(): void {
    this.persistence?.register('notifications', {
      dump: () => this.notifications,
      restore: (data) => {
        this.notifications = (data as NotificationDto[]) ?? [];
      },
    });
  }

  /** CA3: guarda destinatario, tipo, mensaje, entidad relacionada, fecha y estado de lectura (sin leer). */
  notify(input: NotifyInput): NotificationDto | undefined {
    const { userId, email } = input.recipient;
    if (!userId && !email) {
      return undefined;
    }
    const notification: NotificationDto = {
      id: `notif-${randomUUID()}`,
      ...(userId ? { recipientId: userId } : {}),
      ...(email ? { recipientEmail: email.trim().toLowerCase() } : {}),
      type: input.type,
      message: input.message,
      entity: input.entity,
      entityId: input.entityId,
      ...(input.bookingCode ? { bookingCode: input.bookingCode } : {}),
      createdAt: new Date(),
      read: false,
    };
    this.notifications.push(notification);
    return notification;
  }

  /** CA1: al confirmarse una reserva, el huésped y el anfitrión reciben una notificación con el código. */
  bookingConfirmed(booking: BookingNotice): void {
    const title = booking.listingTitle ? ` en "${booking.listingTitle}"` : '';
    const stay = `del ${booking.checkIn.slice(0, 10)} al ${booking.checkOut.slice(0, 10)}`;
    this.notify({
      recipient: { email: booking.guestEmail },
      type: 'RESERVA_CONFIRMADA',
      message: `Tu reserva ${booking.code}${title} ${stay} está confirmada.`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
    this.notify({
      recipient: { userId: booking.hostId },
      type: 'RESERVA_CONFIRMADA',
      message: `Tienes una nueva reserva confirmada ${booking.code}${title} ${stay}.`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
  }

  /** CA2: al cancelarse una reserva se notifica al huésped y al anfitrión. */
  bookingCancelled(booking: BookingNotice, refund: { amount: number; percentage: number; currency: string }): void {
    const title = booking.listingTitle ? ` en "${booking.listingTitle}"` : '';
    const stay = `del ${booking.checkIn.slice(0, 10)} al ${booking.checkOut.slice(0, 10)}`;
    this.notify({
      recipient: { email: booking.guestEmail },
      type: 'RESERVA_CANCELADA',
      message: `Cancelaste la reserva ${booking.code ?? booking.id}${title} ${stay}. Devolución simulada: ${refund.amount} ${refund.currency} (${refund.percentage} %).`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
    this.notify({
      recipient: { userId: booking.hostId },
      type: 'RESERVA_CANCELADA',
      message: `El huésped canceló la reserva ${booking.code ?? booking.id}${title} ${stay}; esas noches vuelven a estar disponibles.`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
  }

  /** CA2: reserva que pasa a revisión manual al bloquear su publicación (RN-020); se notifica al huésped. */
  bookingUnderReview(booking: BookingNotice, reason: string): void {
    this.notify({
      recipient: { email: booking.guestEmail },
      type: 'RESERVA_EN_REVISION',
      message: `Tu reserva ${booking.code ?? booking.id} quedó en revisión: ${reason}. Te avisaremos cuando se resuelva.`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
  }

  /** HU-052 CA1: el administrador mantuvo la reserva en revisión; se avisa al huésped y al anfitrión. */
  bookingReviewKept(booking: BookingNotice, finalStatus: string): void {
    const title = booking.listingTitle ? ` en "${booking.listingTitle}"` : '';
    const stay = `del ${booking.checkIn.slice(0, 10)} al ${booking.checkOut.slice(0, 10)}`;
    const state = finalStatus === 'PENDIENTE' ? 'sigue pendiente de pago' : 'sigue confirmada';
    this.notify({
      recipient: { email: booking.guestEmail },
      type: 'RESERVA_MANTENIDA',
      message: `Revisamos tu reserva ${booking.code ?? booking.id}${title} ${stay} y ${state}. ¡Te esperamos!`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
    this.notify({
      recipient: { userId: booking.hostId },
      type: 'RESERVA_MANTENIDA',
      message: `El administrador revisó la reserva ${booking.code ?? booking.id}${title} ${stay} y ${state}.`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
  }

  /** HU-052 CA2: el administrador canceló la reserva en revisión con devolución del 100 %; se avisa a ambos. */
  bookingReviewCancelled(booking: BookingNotice, refund: { amount: number; percentage: number; currency: string }): void {
    const title = booking.listingTitle ? ` en "${booking.listingTitle}"` : '';
    const stay = `del ${booking.checkIn.slice(0, 10)} al ${booking.checkOut.slice(0, 10)}`;
    this.notify({
      recipient: { email: booking.guestEmail },
      type: 'RESERVA_CANCELADA',
      message:
        `Tras revisar el alojamiento, cancelamos tu reserva ${booking.code ?? booking.id}${title} ${stay}. ` +
        `Te devolvemos el ${refund.percentage} % de lo pagado: ${refund.amount} ${refund.currency} (devolución simulada).`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
    this.notify({
      recipient: { userId: booking.hostId },
      type: 'RESERVA_CANCELADA',
      message: `El administrador canceló la reserva ${booking.code ?? booking.id}${title} ${stay} tras la revisión; esas noches quedaron libres.`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
  }

  /** HU-046 CA3: la estancia terminó y la reserva pasó a COMPLETADA; se invita al huésped a reseñar. */
  bookingCompleted(booking: BookingNotice): void {
    const title = booking.listingTitle ? ` en "${booking.listingTitle}"` : '';
    this.notify({
      recipient: { email: booking.guestEmail },
      type: 'RESERVA_COMPLETADA',
      message: `Tu estancia${title} del ${booking.checkIn.slice(0, 10)} al ${booking.checkOut.slice(0, 10)} terminó (reserva ${booking.code ?? booking.id}). ¡Cuéntanos cómo te fue y reseña el alojamiento!`,
      entity: 'Booking',
      entityId: booking.id,
      bookingCode: booking.code,
    });
  }

  /** HU-049 CA2 (RF-066, RN-021): la reseña fue ocultada por moderación; se notifica al autor. */
  reviewHidden(review: { id: string; guestEmail: string; listingTitle?: string }, reason: string): void {
    const title = review.listingTitle ? ` en "${review.listingTitle}"` : '';
    this.notify({
      recipient: { email: review.guestEmail },
      type: 'RESENA_OCULTADA',
      message: `Tu reseña${title} fue ocultada por moderación: ${reason}.`,
      entity: 'Review' as any,
      entityId: review.id,
    });
  }

  /** CA2: publicación aprobada, devuelta o bloqueada; se notifica a su anfitrión. */
  listingModerated(
    listing: { id: string; title: string; hostId: string },
    type: 'PUBLICACION_APROBADA' | 'PUBLICACION_DEVUELTA' | 'PUBLICACION_BLOQUEADA',
    reason?: string,
  ): void {
    const messages = {
      PUBLICACION_APROBADA: `Tu publicación "${listing.title}" fue aprobada y ya está ACTIVA en las búsquedas.`,
      PUBLICACION_DEVUELTA: `Tu publicación "${listing.title}" fue devuelta a BORRADOR. Motivo: ${reason}`,
      PUBLICACION_BLOQUEADA: `Tu publicación "${listing.title}" fue bloqueada. Motivo: ${reason}`,
    };
    this.notify({ recipient: { userId: listing.hostId }, type, message: messages[type], entity: 'Listing', entityId: listing.id });
  }

  /** CA2: restricción de cuenta; se notifica al usuario restringido. */
  accountRestricted(account: { id: string; email: string }, reason: string): void {
    this.notify({
      recipient: { userId: account.id, email: account.email },
      type: 'CUENTA_RESTRINGIDA',
      message: `Tu cuenta fue restringida. Motivo: ${reason}`,
      entity: 'UserAccount',
      entityId: account.id,
    });
  }

  /** Notificaciones del usuario de la sesión, de la más reciente a la más antigua. */
  findMine(user: NotificationRecipient, onlyUnread = false): NotificationDto[] {
    return this.notifications
      .filter((item) => this.belongsTo(item, user) && (!onlyUnread || !item.read))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** HU-044 CA1 (RF-060, RNF-022): notificaciones ordenadas de la más reciente a la más antigua y paginadas. */
  findMinePaginated(
    user: NotificationRecipient,
    options: { onlyUnread?: boolean; page?: number; limit?: number } = {},
  ): NotificationsSummaryDto {
    const allMatching = this.findMine(user, options.onlyUnread ?? false);
    const unread = this.findMine(user, true).length;
    const rawPage = Number(options.page);
    const rawLimit = Number(options.limit);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(MAX_NOTIFICATIONS_LIMIT, Math.trunc(rawLimit)) : DEFAULT_NOTIFICATIONS_LIMIT;
    const total = allMatching.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    return {
      data: allMatching.slice(start, start + limit),
      unread,
      page: safePage,
      limit,
      total,
      totalPages,
    };
  }

  /** Marca como leída una notificación propia; la de otro usuario responde 404 para no revelar que existe. */
  markAsRead(id: string, user: NotificationRecipient): NotificationDto {
    const notification = this.notifications.find((item) => item.id === id && this.belongsTo(item, user));
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }
    if (!notification.read) {
      notification.read = true;
      notification.readAt = new Date();
    }
    return notification;
  }

  markAllAsRead(user: NotificationRecipient): number {
    const unread = this.findMine(user, true);
    const now = new Date();
    unread.forEach((item) => {
      item.read = true;
      item.readAt = now;
    });
    return unread.length;
  }

  private belongsTo(notification: NotificationDto, user: NotificationRecipient): boolean {
    return (
      (!!user.userId && notification.recipientId === user.userId) ||
      (!!user.email && notification.recipientEmail === user.email.trim().toLowerCase())
    );
  }
}
