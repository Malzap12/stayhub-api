/** HU-037 · Resultado de un pago procesado por el proveedor en modo de pruebas (RF-051, RF-052). */
export enum PaymentStatus {
  APROBADO = 'APROBADO',
  RECHAZADO = 'RECHAZADO',
  /** HU-031 · Pago aprobado que se anuló porque la reserva no se pudo confirmar (RNF-009). */
  REVERTIDO = 'REVERTIDO',
}
