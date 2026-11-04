/** HU-018 · Modalidad de reserva de una publicación (RF-022, RN-015). */
export enum BookingMode {
  /** La reserva queda CONFIRMADA al aprobarse el pago simulado, sin aprobación del anfitrión. */
  INMEDIATA = 'INMEDIATA',
  /** La solicitud queda PENDIENTE_APROBACION hasta que el anfitrión decida. */
  CON_APROBACION = 'CON_APROBACION',
}

/** HU-018 CA1: toda publicación nueva acepta reservas inmediatas salvo que el anfitrión elija otra modalidad. */
export const DEFAULT_BOOKING_MODE = BookingMode.INMEDIATA;
