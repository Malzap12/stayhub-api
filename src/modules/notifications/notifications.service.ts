import { Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { NotificationDto, NotificationType } from './dto/notification.dto';

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
