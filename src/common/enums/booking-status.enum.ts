export enum BookingStatus {
  PENDIENTE = 'PENDIENTE',
  /** HU-018 CA2: solicitud en una publicación con aprobación; espera la decisión del anfitrión (RN-015). */
  PENDIENTE_APROBACION = 'PENDIENTE_APROBACION',
  CONFIRMADA = 'CONFIRMADA',
  CANCELADA = 'CANCELADA',
  COMPLETADA = 'COMPLETADA',
  /** Reserva en revisión manual (RN-020); el cierre diario no la cambia (HU-046 CA2). */
  EN_REVISION = 'EN_REVISION',
}
