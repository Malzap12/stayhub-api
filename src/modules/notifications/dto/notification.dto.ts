import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** HU-043 · Eventos que generan una notificación dentro de la plataforma (RF-059, AMB-32). */
export type NotificationType =
  | 'RESERVA_CONFIRMADA'
  | 'RESERVA_CANCELADA'
  | 'RESERVA_EN_REVISION'
  | 'RESERVA_MANTENIDA'
  | 'RESERVA_COMPLETADA'
  | 'PUBLICACION_APROBADA'
  | 'PUBLICACION_DEVUELTA'
  | 'PUBLICACION_BLOQUEADA'
  | 'CUENTA_RESTRINGIDA'
  | 'RESENA_OCULTADA';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'RESERVA_CONFIRMADA',
  'RESERVA_CANCELADA',
  'RESERVA_EN_REVISION',
  'RESERVA_MANTENIDA',
  'RESERVA_COMPLETADA',
  'PUBLICACION_APROBADA',
  'PUBLICACION_DEVUELTA',
  'PUBLICACION_BLOQUEADA',
  'CUENTA_RESTRINGIDA',
  'RESENA_OCULTADA',
];

/** HU-043 CA3: destinatario, tipo, mensaje, entidad relacionada, fecha y estado de lectura. */
export class NotificationDto {
  @ApiProperty({ example: 'notif-6f1c2a9e' })
  id: string;

  @ApiPropertyOptional({ example: 'user-uuid-123', description: 'Destinatario: ID del usuario' })
  recipientId?: string;

  @ApiPropertyOptional({ example: 'huesped@stayhub.com', description: 'Destinatario: correo del usuario' })
  recipientEmail?: string;

  @ApiProperty({ enum: NOTIFICATION_TYPES, example: 'RESERVA_CONFIRMADA' })
  type: NotificationType;

  @ApiProperty({ example: 'Tu reserva RES-8D17F0D7 en "Cabaña del Bosque" del 2026-11-16 al 2026-11-19 está confirmada.' })
  message: string;

  @ApiProperty({ enum: ['Booking', 'Listing', 'UserAccount'], example: 'Booking', description: 'Tipo de entidad relacionada' })
  entity: 'Booking' | 'Listing' | 'UserAccount' | 'Review';

  @ApiProperty({ example: 'booking-uuid-789', description: 'ID de la entidad relacionada' })
  entityId: string;

  @ApiPropertyOptional({ example: 'RES-8D17F0D7', description: 'Código de la reserva, en las notificaciones de reservas (CA1)' })
  bookingCode?: string;

  @ApiProperty({ example: '2026-10-27T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: false, description: 'Estado de lectura' })
  read: boolean;

  @ApiPropertyOptional({ example: '2026-10-27T16:00:00.000Z' })
  readAt?: Date;
}

export class NotificationsSummaryDto {
  @ApiProperty({ type: [NotificationDto] })
  data: NotificationDto[];

  @ApiProperty({ example: 3, description: 'Notificaciones sin leer' })
  unread: number;

  @ApiProperty({ example: 1, description: 'Página actual (HU-044 CA1)' })
  page: number;

  @ApiProperty({ example: 10, description: 'Tamaño de página (HU-044 CA1)' })
  limit: number;

  @ApiProperty({ example: 15, description: 'Total de notificaciones (HU-044 CA1)' })
  total: number;

  @ApiProperty({ example: 2, description: 'Total de páginas (HU-044 CA1)' })
  totalPages: number;
}
