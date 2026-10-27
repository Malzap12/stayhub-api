import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlatformController } from './platform.controller';
import { PlatformConfigService, validateServiceFee } from './platform-config.service';
import { UpdateServiceFeeDto, DEFAULT_SERVICE_FEE_PERCENT } from './dto/service-fee.dto';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';

describe('HU-029 · Configurar la tarifa de servicio (CA1, CA2, CA3, RF-040, RN-014, RN-021)', () => {
  let controller: PlatformController;
  let platformService: PlatformConfigService;
  let bookingsService: BookingsService;
  let auditService: AuditService;

  const adminSession: ActiveSession = {
    token: 'jwt-admin',
    userId: 'admin-1',
    email: 'admin@inversioneslr.com',
    role: Role.ADMINISTRADOR,
    expiresAt: Date.now() + 60_000,
  };

  const lastAuditEvent = () => {
    const events = auditService.findAll({ action: AuditAction.SERVICE_FEE_UPDATE });
    return events[events.length - 1];
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformController],
      providers: [
        PlatformConfigService,
        BookingsService,
        AuditService,
        ListingsService,
      ],
    }).compile();

    controller = module.get<PlatformController>(PlatformController);
    platformService = module.get<PlatformConfigService>(PlatformConfigService);
    bookingsService = module.get<BookingsService>(BookingsService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe('CA1 · Administrador configura la tarifa entre 0 % y 30 % y aplica a nuevas cotizaciones', () => {
    it('inicia con la tarifa por defecto (12 %)', () => {
      const config = controller.getServiceFee();
      expect(config.serviceFeePercent).toBe(DEFAULT_SERVICE_FEE_PERCENT);
      expect(config.percentage).toBe(DEFAULT_SERVICE_FEE_PERCENT);
    });

    it('permite al administrador cambiar la tarifa a un valor válido (ej. 15 %)', () => {
      const updated = controller.updateServiceFee({ serviceFeePercent: 15 }, adminSession);
      expect(updated.serviceFeePercent).toBe(15);
      expect(controller.getServiceFee().serviceFeePercent).toBe(15);
    });

    it('acepta los valores límite permitidos: 0 % y 30 % (RN-014)', () => {
      expect(controller.updateServiceFee({ serviceFeePercent: 0 }, adminSession).serviceFeePercent).toBe(0);
      expect(controller.updateServiceFee({ serviceFeePercent: 30 }, adminSession).serviceFeePercent).toBe(30);
    });

    it('las cotizaciones nuevas usan el nuevo porcentaje configurado', async () => {
      // Con tarifa en 10%:
      controller.updateServiceFee({ serviceFeePercent: 10 }, adminSession);
      // Publicación de ejemplo a 280.000 COP por noche y sin tarifa de limpieza.
      const quote10 = await bookingsService.quote({
        listingId: 'demo-bogota-chapinero',
        checkIn: '2026-11-01',
        checkOut: '2026-11-03', // 2 noches
        guests: 2,
      });

      // baseAmount = 2 × 280.000 = 560.000; serviceFee = 10 % de 560.000 = 56.000
      expect(quote10.baseAmount).toBe(560000);
      expect(quote10.serviceFee).toBe(56000);

      // Cambiamos tarifa al 20%:
      controller.updateServiceFee({ serviceFeePercent: 20 }, adminSession);
      const quote20 = await bookingsService.quote({
        listingId: 'demo-bogota-chapinero',
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
        guests: 2,
      });

      // serviceFee = 20 % de 560.000 = 112.000
      expect(quote20.baseAmount).toBe(560000);
      expect(quote20.serviceFee).toBe(112000);
    });
  });

  describe('CA2 · Las reservas confirmadas conservan la tarifa con que se confirmaron', () => {
    it('una reserva confirmada mantiene su total y serviceFee históricos tras cambiar el porcentaje', async () => {
      // 1. Configuramos tarifa inicial al 12%
      controller.updateServiceFee({ serviceFeePercent: 12 }, adminSession);

      // 2. Creamos y confirmamos una reserva (HU-031: la confirmación exige un periodo disponible; Chapinero lo tiene en diciembre)
      const booking = await bookingsService.createInstant(
        {
          listingId: 'demo-bogota-chapinero',
          checkIn: '2026-12-01',
          checkOut: '2026-12-05',
          guests: 2,
          idempotencyKey: 'ca2-booking-idempotency',
        },
        'guest@stayhub.com',
      );
      await bookingsService.confirmBooking(booking.id, 'host@stayhub.com');

      const originalTotal = booking.totalAmount;
      const originalServiceFee = booking.serviceFee;

      // 3. Administrador cambia la tarifa de servicio al 25%
      controller.updateServiceFee({ serviceFeePercent: 25 }, adminSession);

      // 4. Verificamos que la reserva confirmada conserva los valores originales
      const retrieved = await bookingsService.findOne(booking.id);
      expect(retrieved.status).toBe(BookingStatus.CONFIRMADA);
      expect(retrieved.totalAmount).toBe(originalTotal);
      expect(retrieved.serviceFee).toBe(originalServiceFee);
    });
  });

  describe('CA3 · El cambio queda en la auditoría con el valor anterior y el nuevo', () => {
    it('registra evento en la auditoría con el valor anterior y el nuevo cuando el cambio es exitoso', () => {
      controller.updateServiceFee({ serviceFeePercent: 12 }, adminSession);
      controller.updateServiceFee({ serviceFeePercent: 18 }, adminSession);

      const event = lastAuditEvent();
      expect(event).toBeDefined();
      expect(event.actor).toBe(adminSession.email);
      expect(event.result).toBe(AuditResult.EXITOSO);
      expect(event.detail).toContain('12 %');
      expect(event.detail).toContain('18 %');
      expect(event.entity).toBe('PlatformConfig');
    });

    it('rechaza valores fuera del rango [0, 30] % y registra auditoría de fallo (RN-014, RN-021)', () => {
      expect(() => controller.updateServiceFee({ serviceFeePercent: -5 }, adminSession)).toThrow(BadRequestException);
      let failedEvent = lastAuditEvent();
      expect(failedEvent.result).toBe(AuditResult.FALLIDO);
      expect(failedEvent.detail).toContain('-5%');

      expect(() => controller.updateServiceFee({ serviceFeePercent: 35 }, adminSession)).toThrow(BadRequestException);
      failedEvent = lastAuditEvent();
      expect(failedEvent.result).toBe(AuditResult.FALLIDO);
      expect(failedEvent.detail).toContain('35%');
    });
  });

  describe('Validaciones y persistencia (RN-014)', () => {
    it('la función validateServiceFee valida correctamente números y rangos', () => {
      expect(validateServiceFee(12)).toBeNull();
      expect(validateServiceFee(0)).toBeNull();
      expect(validateServiceFee(30)).toBeNull();
      expect(validateServiceFee(-0.1)).toContain('entre 0 % y 30 %');
      expect(validateServiceFee(30.1)).toContain('entre 0 % y 30 %');
      expect(validateServiceFee('12')).toContain('debe ser un número');
      expect(validateServiceFee(NaN)).toContain('debe ser un número');
    });

    it('el DTO rechaza valores inválidos mediante class-validator', async () => {
      const invalidLow = plainToInstance(UpdateServiceFeeDto, { serviceFeePercent: -1 });
      const errorsLow = await validate(invalidLow);
      expect(errorsLow.length).toBeGreaterThan(0);

      const invalidHigh = plainToInstance(UpdateServiceFeeDto, { serviceFeePercent: 31 });
      const errorsHigh = await validate(invalidHigh);
      expect(errorsHigh.length).toBeGreaterThan(0);

      const valid = plainToInstance(UpdateServiceFeeDto, { serviceFeePercent: 15 });
      const errorsValid = await validate(valid);
      expect(errorsValid.length).toBe(0);
    });
  });
});
