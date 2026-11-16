import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/** HU-043 · Eventos que generan una notificación dentro de la plataforma (RF-059, AMB-32). */
export type NotificationType =
  | 'RESERVA_CONFIRMADA'
  | 'SOLICITUD_RESERVA'
  | 'SOLICITUD_RECHAZADA'
  | 'PAGO_RECHAZADO'
  | 'RESERVA_CANCELADA'
  | 'RESERVA_EN_REVISION'
  | 'RESERVA_MANTENIDA'
  | 'RESERVA_COMPLETADA'
  | 'PUBLICACION_APROBADA'
  | 'PUBLICACION_DEVUELTA'
  | 'PUBLICACION_BLOQUEADA'
  | 'PUBLICACION_PAUSADA'
  | 'CUENTA_RESTRINGIDA'
  | 'RESENA_OCULTADA'
  | 'MENSAJE_NUEVO';

export const NOTIFICATION_TYPES: NotificationType[] = [
  'RESERVA_CONFIRMADA',
  'SOLICITUD_RESERVA',
  'SOLICITUD_RECHAZADA',
  'PAGO_RECHAZADO',
  'RESERVA_CANCELADA',
  'RESERVA_EN_REVISION',
  'RESERVA_MANTENIDA',
  'RESERVA_COMPLETADA',
  'PUBLICACION_APROBADA',
  'PUBLICACION_DEVUELTA',
  'PUBLICACION_BLOQUEADA',
  'PUBLICACION_PAUSADA',
  'CUENTA_RESTRINGIDA',
  'RESENA_OCULTADA',
  'MENSAJE_NUEVO',
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

  @ApiProperty({ enum: ['Booking', 'Listing', 'UserAccount', 'Review', 'Conversation'], example: 'Booking', description: 'Tipo de entidad relacionada' })
  entity: 'Booking' | 'Listing' | 'UserAccount' | 'Review' | 'Conversation';

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

  @ApiProperty({ example: 3, description: 'Notificaciones sin leer (HU-045 CA1)' })
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

export class UnreadNotificationsCountDto {
  @ApiProperty({ example: 3, description: 'Cantidad de notificaciones no leídas (HU-045 CA1 · RF-061)' })
  unread: number;
}

export class MarkNotificationsReadDto {
  @ApiProperty({
    type: [String],
    example: ['notif-6f1c2a9e', 'notif-9a8b7c6d'],
    description: 'IDs de una o varias notificaciones a marcar como leídas (HU-045 CA2 · RF-061)',
  })
  @IsArray({ message: 'ids debe ser un arreglo de identificadores' })
  @ArrayNotEmpty({ message: 'Debes enviar al menos una notificación para marcar como leída' })
  @IsString({ each: true, message: 'Cada identificador debe ser texto' })
  ids: string[];
}

export class MarkNotificationsReadResultDto {
  @ApiProperty({ example: 2, description: 'Cantidad marcada como leída en esta operación (HU-045 CA2)' })
  updated: number;

  @ApiProperty({ example: 1, description: 'Contador actualizado de notificaciones no leídas (HU-045 CA2)' })
  unread: number;
}
