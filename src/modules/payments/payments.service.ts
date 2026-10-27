import { BadRequestException, Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { PaymentCardDto, PaymentConfigDto, PaymentResponseDto, TestCardDto } from './dto/payment.dto';

export const PAYMENT_PROVIDER_NAME = 'StayHub Sandbox';
export const PAYMENT_TEST_MODE = 'test';

/** Variables de entorno que pueden contener claves del proveedor de pagos. */
export const PAYMENT_KEY_ENV_VARS = ['PAYMENT_SECRET_KEY', 'PAYMENT_PUBLIC_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'];

/** Prefijos de claves de producción de los proveedores habituales (Stripe `*_live_`, Wompi `*_prod_`). */
const LIVE_KEY_PATTERN = /^(sk|pk|rk)_live_|^(prv|pub)_prod_/i;

/**
 * HU-037 · Catálogo de tarjetas de prueba del proveedor simulado (CA1, CA2).
 * Cualquier otra tarjeta se rechaza con 400: nunca se procesa una tarjeta real.
 */
export const TEST_CARDS: TestCardDto[] = [
  { number: '4242424242424242', brand: 'VISA', outcome: PaymentStatus.APROBADO, description: 'Pago aprobado' },
  { number: '5555555555554444', brand: 'MASTERCARD', outcome: PaymentStatus.APROBADO, description: 'Pago aprobado' },
  {
    number: '4000000000000002',
    brand: 'VISA',
    outcome: PaymentStatus.RECHAZADO,
    declineReason: 'TARJETA_RECHAZADA',
    description: 'Pago rechazado por el emisor',
  },
  {
    number: '4000000000009995',
    brand: 'VISA',
    outcome: PaymentStatus.RECHAZADO,
    declineReason: 'FONDOS_INSUFICIENTES',
    description: 'Pago rechazado por fondos insuficientes',
  },
];

export interface ChargeRequest {
  bookingId: string;
  amount: number;
  currency: string;
  card: PaymentCardDto;
}

/**
 * HU-037 · Pagar la reserva en modo de pruebas (CA1, CA2, CA3 · RF-051, RF-052, RN-022, RNF-005).
 * Proveedor simulado que solo opera en modo de pruebas: si se configura otro modo o alguna clave de
 * producción, la aplicación no arranca y ningún cobro se procesa.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  onModuleInit(): void {
    this.assertTestMode();
    this.logger.log(`Pagos en modo de pruebas (${PAYMENT_PROVIDER_NAME}); no se procesa dinero real`);
  }

  private env(name: string): string | undefined {
    const value = this.config?.get<string>(name) ?? process.env[name];
    return value?.trim() || undefined;
  }

  private configuredMode(): string {
    return (this.env('PAYMENT_MODE') ?? PAYMENT_TEST_MODE).toLowerCase();
  }

  private liveKeyVars(): string[] {
    return PAYMENT_KEY_ENV_VARS.filter((name) => LIVE_KEY_PATTERN.test(this.env(name) ?? ''));
  }

  /** CA3 · Garantiza que el proveedor esté en modo de pruebas y sin claves de producción. */
  assertTestMode(): void {
    if (this.configuredMode() !== PAYMENT_TEST_MODE) {
      throw new ServiceUnavailableException(
        `Los pagos solo pueden procesarse en modo de pruebas (PAYMENT_MODE=${PAYMENT_TEST_MODE})`,
      );
    }
    const liveKeys = this.liveKeyVars();
    if (liveKeys.length > 0) {
      throw new ServiceUnavailableException(
        `Se detectaron claves de producción en ${liveKeys.join(', ')}; solo se permiten claves de prueba`,
      );
    }
  }

  getConfig(): PaymentConfigDto {
    return {
      provider: PAYMENT_PROVIDER_NAME,
      mode: 'TEST',
      testMode: this.configuredMode() === PAYMENT_TEST_MODE,
      liveKeysConfigured: this.liveKeyVars().length > 0,
      configuredKeys: PAYMENT_KEY_ENV_VARS.filter((name) => this.env(name) != null),
    };
  }

  listTestCards(): TestCardDto[] {
    return TEST_CARDS.map((card) => ({ ...card }));
  }

  /** CA1 / CA2 · Procesa el cobro con una tarjeta de prueba y devuelve APROBADO o RECHAZADO con su referencia. */
  charge(request: ChargeRequest): PaymentResponseDto {
    this.assertTestMode();

    if (!Number.isFinite(request.amount) || request.amount <= 0) {
      throw new BadRequestException('El monto a pagar debe ser mayor que cero');
    }

    const number = String(request.card.cardNumber ?? '').replace(/\s+/g, '');
    const testCard = TEST_CARDS.find((card) => card.number === number);
    if (!testCard) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'TARJETA_NO_DE_PRUEBA',
        message: 'Solo se aceptan tarjetas de prueba del proveedor; no se procesan pagos con dinero real',
      });
    }

    const expired = this.isExpired(Number(request.card.expMonth), Number(request.card.expYear));
    const status = expired ? PaymentStatus.RECHAZADO : testCard.outcome;
    const declineReason = expired ? 'TARJETA_VENCIDA' : testCard.declineReason;
    const message = expired ? 'Pago rechazado: la tarjeta está vencida' : testCard.description;

    return {
      id: `pay-${randomUUID()}`,
      reference: `TEST-${randomBytes(5).toString('hex').toUpperCase()}`,
      bookingId: request.bookingId,
      status,
      ...(declineReason ? { declineReason } : {}),
      message,
      amount: request.amount,
      currency: request.currency,
      cardBrand: testCard.brand,
      cardLast4: number.slice(-4),
      mode: 'TEST',
      provider: PAYMENT_PROVIDER_NAME,
      processedAt: new Date(),
    };
  }

  /** HU-031 · Anula un pago aprobado cuando la reserva no se pudo confirmar, para no cobrar sin reserva (RNF-009). */
  revert(payment: PaymentResponseDto): PaymentResponseDto {
    return {
      ...payment,
      status: PaymentStatus.REVERTIDO,
      message: 'Pago revertido: la reserva no se pudo confirmar',
      processedAt: new Date(),
    };
  }

  private isExpired(month: number, year: number, now = new Date()): boolean {
    const current = now.getFullYear() * 12 + now.getMonth() + 1;
    return year * 12 + month < current;
  }
}
