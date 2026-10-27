import type { CancellationPolicyDto } from './dto/listing-detail.dto';

export type CancellationPolicyCode = 'FLEXIBLE';

/**
 * HU-039 · Catálogo de políticas de cancelación (RF-058, RN-016, AMB-10).
 * CA1: Existe la política Flexible: 100 % de devolución hasta 48 h antes de la llegada y 50 % después.
 * CA2: Su texto explica la regla con un ejemplo de fechas en el detalle de la publicación.
 * Si el anfitrión no elige una política, se asigna la Flexible.
 */
export const CANCELLATION_POLICIES: Record<CancellationPolicyCode, CancellationPolicyDto> = {
  FLEXIBLE: {
    code: 'FLEXIBLE',
    name: 'Flexible',
    description:
      'Reembolso del 100 % si cancelas hasta 48 horas antes de la llegada y del 50 % después. Por ejemplo, si tu llegada es el 15 de noviembre a las 15:00, recibes el 100 % de devolución si cancelas hasta el 13 de noviembre a las 15:00 y el 50 % si cancelas entre el 13 y el 15 de noviembre antes del check-in.',
    rules: [
      { minHoursBeforeCheckIn: 48, refundPercentage: 100 },
      { minHoursBeforeCheckIn: 0, refundPercentage: 50 },
    ],
  },
};

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicyCode = 'FLEXIBLE';

/** HU-039 CA1: retorna el catálogo de políticas de cancelación disponibles para asociar a una publicación. */
export function getCancellationPoliciesCatalog(): CancellationPolicyDto[] {
  return Object.values(CANCELLATION_POLICIES);
}
