import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentsService, PAYMENT_KEY_ENV_VARS, TEST_CARDS } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentCardDto } from './dto/payment.dto';
import { PaymentStatus } from '../../common/enums/payment-status.enum';

const configWith = (values: Record<string, string>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;

const futureYear = new Date().getFullYear() + 3;
const card = (cardNumber: string, overrides: Partial<PaymentCardDto> = {}): PaymentCardDto => ({
  cardNumber,
  cardHolder: 'Ana Pérez',
  expMonth: 12,
  expYear: futureYear,
  cvc: '123',
  ...overrides,
});

describe('HU-037 · Proveedor de pagos en modo de pruebas (CA1, CA2, CA3, RF-051, RF-052, RNF-005)', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ['PAYMENT_MODE', ...PAYMENT_KEY_ENV_VARS]) {
      envBackup[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe('CA1 · tarjeta de prueba aprobada', () => {
    it('deja el pago APROBADO con referencia, marca y últimos 4 dígitos', () => {
      const payment = new PaymentsService().charge({
        bookingId: 'booking-1',
        amount: 715000,
        currency: 'COP',
        card: card('4242 4242 4242 4242'),
      });

      expect(payment).toMatchObject({
        bookingId: 'booking-1',
        status: PaymentStatus.APROBADO,
        amount: 715000,
        currency: 'COP',
        cardBrand: 'VISA',
        cardLast4: '4242',
        mode: 'TEST',
      });
      expect(payment.reference).toMatch(/^TEST-[0-9A-F]{10}$/);
      expect(payment.declineReason).toBeUndefined();
      expect(JSON.stringify(payment)).not.toContain('4242424242424242');
      expect(JSON.stringify(payment)).not.toContain('"cvc"');
    });

    it('genera una referencia distinta en cada pago', () => {
      const service = new PaymentsService();
      const request = { bookingId: 'b', amount: 1000, currency: 'COP', card: card('5555555555554444') };
      expect(service.charge(request).reference).not.toEqual(service.charge(request).reference);
    });
  });

  describe('HU-031 · revertir un pago aprobado (RNF-009)', () => {
    it('conserva la referencia y el monto y deja el pago REVERTIDO', () => {
      const service = new PaymentsService();
      const payment = service.charge({ bookingId: 'booking-31', amount: 500000, currency: 'COP', card: card('4242424242424242') });

      const reverted = service.revert(payment);

      expect(reverted).toMatchObject({
        reference: payment.reference,
        amount: 500000,
        status: PaymentStatus.REVERTIDO,
        message: 'Pago revertido: la reserva no se pudo confirmar',
      });
      expect(payment.status).toBe(PaymentStatus.APROBADO);
    });
  });

  describe('CA2 · tarjeta de prueba rechazada', () => {
    it.each([
      ['4000000000000002', 'TARJETA_RECHAZADA'],
      ['4000000000009995', 'FONDOS_INSUFICIENTES'],
    ])('la tarjeta %s deja el pago RECHAZADO (%s)', (number, reason) => {
      const payment = new PaymentsService().charge({ bookingId: 'b', amount: 1000, currency: 'COP', card: card(number) });
      expect(payment.status).toBe(PaymentStatus.RECHAZADO);
      expect(payment.declineReason).toBe(reason);
      expect(payment.reference).toBeDefined();
    });

    it('rechaza una tarjeta de prueba vencida', () => {
      const payment = new PaymentsService().charge({
        bookingId: 'b',
        amount: 1000,
        currency: 'COP',
        card: card('4242424242424242', { expMonth: 1, expYear: 2020 }),
      });
      expect(payment).toMatchObject({ status: PaymentStatus.RECHAZADO, declineReason: 'TARJETA_VENCIDA' });
    });

    it('no procesa tarjetas que no son de prueba (sin dinero real)', () => {
      const service = new PaymentsService();
      expect(() => service.charge({ bookingId: 'b', amount: 1000, currency: 'COP', card: card('4111111111111112') })).toThrow(
        BadRequestException,
      );
    });

    it('no procesa montos no positivos', () => {
      const service = new PaymentsService();
      expect(() => service.charge({ bookingId: 'b', amount: 0, currency: 'COP', card: card('4242424242424242') })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('CA3 · solo modo de pruebas y ninguna clave de producción', () => {
    it('por defecto opera en modo de pruebas y la configuración lo refleja', () => {
      const service = new PaymentsService(configWith({ PAYMENT_SECRET_KEY: 'sk_test_stayhub' }));
      expect(() => service.onModuleInit()).not.toThrow();
      expect(service.getConfig()).toEqual({
        provider: 'StayHub Sandbox',
        mode: 'TEST',
        testMode: true,
        liveKeysConfigured: false,
        configuredKeys: ['PAYMENT_SECRET_KEY'],
      });
    });

    it.each(['sk_live_123', 'pk_live_abc', 'prv_prod_xyz', 'pub_prod_xyz'])(
      'impide arrancar y cobrar si hay una clave de producción (%s)',
      (liveKey) => {
        const service = new PaymentsService(configWith({ STRIPE_SECRET_KEY: liveKey }));
        expect(() => service.onModuleInit()).toThrow(ServiceUnavailableException);
        expect(service.getConfig().liveKeysConfigured).toBe(true);
        expect(() => service.charge({ bookingId: 'b', amount: 1000, currency: 'COP', card: card('4242424242424242') })).toThrow(
          ServiceUnavailableException,
        );
      },
    );

    it('impide cobrar si el modo configurado no es de pruebas', () => {
      process.env.PAYMENT_MODE = 'live';
      const service = new PaymentsService();
      expect(service.getConfig().testMode).toBe(false);
      expect(() => service.charge({ bookingId: 'b', amount: 1000, currency: 'COP', card: card('4242424242424242') })).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('PaymentsController', () => {
    it('expone las tarjetas de prueba y la configuración', () => {
      const controller = new PaymentsController(new PaymentsService());
      expect(controller.listTestCards()).toEqual(TEST_CARDS);
      expect(controller.getConfig().mode).toBe('TEST');
    });
  });

  describe('PaymentCardDto', () => {
    it('acepta una tarjeta bien formada', async () => {
      const errors = await validate(plainToInstance(PaymentCardDto, card('4242 4242 4242 4242')));
      expect(errors).toHaveLength(0);
    });

    it('rechaza número, CVC y mes inválidos', async () => {
      const errors = await validate(
        plainToInstance(PaymentCardDto, { cardNumber: '42AB', cardHolder: '', expMonth: 13, expYear: futureYear, cvc: '12' }),
      );
      expect(errors.map((error) => error.property).sort()).toEqual(['cardHolder', 'cardNumber', 'cvc', 'expMonth']);
    });
  });
});
