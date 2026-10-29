import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { CreateAdditionalServiceDto, MAX_ADDITIONAL_SERVICES, UpdateAdditionalServiceDto } from './dto/additional-service.dto';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-016 · Ofrecer servicios adicionales con costo (CA1, CA2, RF-020, RN-004, RN-013)', () => {
  let controller: ListingsController;
  let listings: ListingsService;
  let bookings: BookingsService;
  let audit: AuditService;
  let host: ActiveSession;

  const listingId = 'demo-bogota-chapinero';
  const stay = { listingId, checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 2 };
  const quote = (additionalServices: string[] = []) => bookings.quote({ ...stay, additionalServices });

  beforeEach(async () => {
    jest.useFakeTimers({ now: new Date('2026-10-28T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, BookingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService, AuthService],
    }).compile();
    module.get(BookingsService).onModuleInit();

    controller = module.get(ListingsController);
    listings = module.get(ListingsService);
    bookings = module.get(BookingsService);
    audit = module.get(AuditService);
    listings.getListing(listingId)!.additionalServices = [];
    host = {
      token: 'jwt-host',
      userId: listings.getListing(listingId)!.hostId!,
      email: 'anfitrion@prueba.com',
      role: Role.ANFITRION,
      expiresAt: Date.now() + 3_600_000,
    };
  });

  afterEach(() => jest.useRealTimers());

  describe('CA1 · Agregar un servicio con nombre y costo mayor que 0', () => {
    it('aparece en el detalle de la publicación', () => {
      const result = controller.addAdditionalService(listingId, { name: '  Desayuno   para dos ', cost: 45000 }, host);

      expect(result).toEqual([{ id: expect.stringMatching(/^svc-/), name: 'Desayuno para dos', cost: 45000 }]);
      expect(listings.getListingDetail(listingId).additionalServices).toEqual(result);
    });

    it('se puede seleccionar al cotizar y suma su costo al total', async () => {
      controller.addAdditionalService(listingId, { name: 'Traslado desde el aeropuerto', cost: 80000 }, host);
      const without = await quote();

      const withService = await quote(['Traslado desde el aeropuerto']);

      expect(withService.additionalServices).toEqual([{ name: 'Traslado desde el aeropuerto', cost: 80000 }]);
      expect(withService.additionalServicesTotal).toBe(80000);
      expect(withService.subtotal).toBe(without.subtotal + 80000);
    });

    it('rechaza un costo de 0 o negativo', async () => {
      expect(() => listings.addAdditionalService(listingId, { name: 'Gratis', cost: 0 }, host)).toThrow(BadRequestException);
      expect(() => listings.addAdditionalService(listingId, { name: 'Negativo', cost: -100 }, host)).toThrow(BadRequestException);

      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      await expect(pipe.transform({ name: 'Gratis', cost: 0 }, { type: 'body', metatype: CreateAdditionalServiceDto })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(pipe.transform({ name: 'ab', cost: 10 }, { type: 'body', metatype: CreateAdditionalServiceDto })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('no repite nombres, aunque cambien las mayúsculas', () => {
      listings.addAdditionalService(listingId, { name: 'Desayuno', cost: 30000 }, host);

      expect(() => listings.addAdditionalService(listingId, { name: 'DESAYUNO', cost: 35000 }, host)).toThrow(BadRequestException);
    });

    it(`admite máximo ${MAX_ADDITIONAL_SERVICES} servicios`, () => {
      for (let i = 1; i <= MAX_ADDITIONAL_SERVICES; i += 1) {
        listings.addAdditionalService(listingId, { name: `Servicio ${i}`, cost: 1000 * i }, host);
      }

      expect(() => listings.addAdditionalService(listingId, { name: 'Uno más', cost: 5000 }, host)).toThrow(BadRequestException);
    });

    it('solo el anfitrión dueño agrega servicios, y cada intento queda en la auditoría', () => {
      const other = { ...host, userId: 'otro-anfitrion' };

      expect(() => listings.addAdditionalService(listingId, { name: 'Desayuno', cost: 30000 }, other)).toThrow(NotFoundException);
      listings.addAdditionalService(listingId, { name: 'Desayuno', cost: 30000 }, host);

      const events = audit.findAll({ action: AuditAction.LISTING_PRICING_UPDATE, entity: 'Listing' });
      expect(events.map((event) => event.result)).toEqual([AuditResult.FALLIDO, AuditResult.EXITOSO]);
      expect(events[1].detail).toContain('Servicio adicional agregado: Desayuno (30000 COP');
    });
  });

  describe('CA2 · Modificar o eliminar aplica a cotizaciones nuevas sin alterar reservas', () => {
    const book = async (services: string[]) => {
      const booking = await bookings.createInstant(
        { ...stay, additionalServices: services, idempotencyKey: '00000000-0000-4000-8000-000000000016' },
        'huesped@prueba.com',
      );
      booking.status = BookingStatus.CONFIRMADA;
      return booking;
    };

    it('al modificar el costo, la cotización nueva usa el costo nuevo y la reserva confirmada conserva el anterior', async () => {
      const [service] = listings.addAdditionalService(listingId, { name: 'Desayuno', cost: 45000 }, host);
      const booking = await book(['Desayuno']);
      const totalBefore = booking.totalAmount;

      const result = controller.updateAdditionalService(listingId, service.id!, { cost: 60000 }, host);

      expect(result).toEqual([{ id: service.id, name: 'Desayuno', cost: 60000 }]);
      expect((await quote(['Desayuno'])).additionalServicesTotal).toBe(60000);
      expect(booking.additionalServices).toEqual([{ name: 'Desayuno', cost: 45000 }]);
      expect(booking.totalAmount).toBe(totalBefore);
      expect((await bookings.findOne(booking.id)).additionalServices).toEqual([{ name: 'Desayuno', cost: 45000 }]);
    });

    it('al renombrar, la cotización nueva usa el nombre nuevo y el anterior ya no se puede elegir', async () => {
      const [service] = listings.addAdditionalService(listingId, { name: 'Desayuno', cost: 45000 }, host);

      listings.updateAdditionalService(listingId, service.id!, { name: 'Desayuno típico' }, host);

      expect((await quote(['Desayuno típico'])).additionalServices).toEqual([{ name: 'Desayuno típico', cost: 45000 }]);
      await expect(quote(['Desayuno'])).rejects.toThrow(BadRequestException);
    });

    it('al eliminar, deja de ofrecerse y la reserva confirmada lo conserva', async () => {
      const [service] = listings.addAdditionalService(listingId, { name: 'Traslado', cost: 80000 }, host);
      const booking = await book(['Traslado']);

      const remaining = controller.removeAdditionalService(listingId, service.id!, host);

      expect(remaining).toEqual([]);
      expect(listings.getListingDetail(listingId).additionalServices).toEqual([]);
      await expect(quote(['Traslado'])).rejects.toThrow(BadRequestException);
      expect(booking.additionalServices).toEqual([{ name: 'Traslado', cost: 80000 }]);
      expect(booking.additionalServicesTotal).toBe(80000);
    });

    it('valida el cambio: sin datos, nombre repetido, costo 0 o servicio inexistente', async () => {
      const [first] = listings.addAdditionalService(listingId, { name: 'Desayuno', cost: 45000 }, host);
      listings.addAdditionalService(listingId, { name: 'Traslado', cost: 80000 }, host);

      expect(() => listings.updateAdditionalService(listingId, first.id!, {}, host)).toThrow(BadRequestException);
      expect(() => listings.updateAdditionalService(listingId, first.id!, { name: 'traslado' }, host)).toThrow(BadRequestException);
      expect(() => listings.updateAdditionalService(listingId, first.id!, { cost: 0 }, host)).toThrow(BadRequestException);
      expect(() => listings.updateAdditionalService(listingId, 'svc-no-existe', { cost: 10 }, host)).toThrow(NotFoundException);
      expect(() => listings.removeAdditionalService(listingId, 'svc-no-existe', host)).toThrow(NotFoundException);
      expect(listings.updateAdditionalService(listingId, first.id!, { name: 'Desayuno' }, host)[0].name).toBe('Desayuno');

      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      await expect(pipe.transform({ cost: -5 }, { type: 'body', metatype: UpdateAdditionalServiceDto })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('los servicios guardados sin identificador reciben uno al consultarlos', () => {
      listings.getListing(listingId)!.additionalServices = [{ name: 'Tour guiado', cost: 60000 }];

      const [service] = controller.getAdditionalServices(listingId, host);

      expect(service).toEqual({ id: expect.stringMatching(/^svc-/), name: 'Tour guiado', cost: 60000 });
      expect(controller.getAdditionalServices(listingId, host)[0].id).toBe(service.id);
    });
  });
});
