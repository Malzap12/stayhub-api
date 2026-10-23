import type { CancellationPolicyDto } from './dto/listing-detail.dto';

export type CancellationPolicyCode = 'FLEXIBLE';

/**
 * Catálogo de políticas de cancelación (RF-058). El MVP ofrece al menos la Flexible:
 * 100 % de devolución hasta 48 h antes de la llegada y 50 % después.
 * Si el anfitrión no elige una política, se asigna la Flexible.
 */
export const CANCELLATION_POLICIES: Record<CancellationPolicyCode, CancellationPolicyDto> = {
  FLEXIBLE: {
    code: 'FLEXIBLE',
    name: 'Flexible',
    description: 'Reembolso del 100 % si cancelas hasta 48 horas antes de la llegada; después, del 50 %.',
    rules: [
      { minHoursBeforeCheckIn: 48, refundPercentage: 100 },
      { minHoursBeforeCheckIn: 0, refundPercentage: 50 },
    ],
  },
};

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicyCode = 'FLEXIBLE';
