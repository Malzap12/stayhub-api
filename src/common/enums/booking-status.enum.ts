export enum BookingStatus {
  PENDIENTE = 'PENDIENTE',
  CONFIRMADA = 'CONFIRMADA',
  CANCELADA = 'CANCELADA',
  COMPLETADA = 'COMPLETADA',
  /** Reserva en revisión manual (RN-020); el cierre diario no la cambia (HU-046 CA2). */
  EN_REVISION = 'EN_REVISION',
}
