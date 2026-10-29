import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-014 · Pausar y reactivar mi publicación (CA1, CA2, CA3, RF-018, RN-005, RN-006)', () => {
  let controller: ListingsController;
  let listings: ListingsService;
  let bookings: BookingsService;
  let audit: AuditService;
  let store: BookingResponseDto[];
  let host: ActiveSession;

  const listingId = 'demo-bogota-chapinero';
  const listing = () => listings.getListing(listingId)!;
  const searchIds = async () => (await listings.search({} as never)).data.map((item) => item.id);
  const statusEvents = () => audit.findAll({ action: AuditAction.LISTING_STATUS_CHANGE });
  const confirmed = (id: string): BookingResponseDto => ({
    id,
    code: `RES-${id.toUpperCase()}`,
    listingId,
    guestId: `${id}@prueba.com`,
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    guests: 2,
    totalAmount: 900000,
    serviceFee: 80000,
    currency: 'COP',
    status: BookingStatus.CONFIRMADA,
    idempotencyKey: `key-${id}`,
    createdAt: new Date('2026-10-01T12:00:00Z'),
  });

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
    store = (bookings as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;
    host = { token: 'jwt-host', userId: listing().hostId!, email: 'anfitrion@prueba.com', role: Role.ANFITRION, expiresAt: Date.now() + 3_600_000 };
  });

  afterEach(() => jest.useRealTimers());

  describe('CA1 · Pausar una publicación ACTIVA', () => {
    it('pasa a PAUSADA y deja de aparecer en las búsquedas', async () => {
      expect(await searchIds()).toContain(listingId);

      const result = controller.pauseListing(listingId, host);

      expect(result).toMatchObject({ id: listingId, status: ListingStatus.PAUSADA });
      expect(listing().status).toBe(ListingStatus.PAUSADA);
      expect(await searchIds()).not.toContain(listingId);
    });

    it('el huésped ya no ve el detalle ni puede reservar', async () => {
      listings.pauseListing(listingId, host);

      expect(() => listings.getListingDetail(listingId)).toThrow(NotFoundException);
      await expect(
        bookings.createInstant(
          { listingId, checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 2, idempotencyKey: '00000000-0000-4000-8000-000000000014' },
          'huesped@prueba.com',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('el anfitrión la sigue viendo como Pausada en sus publicaciones', () => {
      listings.pauseListing(listingId, host);

      expect(listings.findMine(host.userId).find((item) => item.id === listingId)).toMatchObject({ status: ListingStatus.PAUSADA });
    });

    it('solo se pausa una publicación ACTIVA', () => {
      for (const status of [ListingStatus.BORRADOR, ListingStatus.PENDIENTE_REVISION, ListingStatus.BLOQUEADA, ListingStatus.PAUSADA]) {
        listing().status = status;
        expect(() => listings.pauseListing(listingId, host)).toThrow(BadRequestException);
        expect(listing().status).toBe(status);
      }
    });

    it('solo el anfitrión dueño la pausa (RN-005)', () => {
      expect(() => listings.pauseListing(listingId, { ...host, userId: 'otro-anfitrion' })).toThrow(NotFoundException);
      expect(() => listings.pauseListing('no-existe', host)).toThrow(NotFoundException);
      expect(listing().status).toBe(ListingStatus.ACTIVA);
    });

    it('la pausa y los intentos rechazados quedan en la auditoría', () => {
      listings.pauseListing(listingId, host);
      expect(() => listings.pauseListing(listingId, host)).toThrow(BadRequestException);

      const events = statusEvents().filter((event) => event.entityId === listingId);
      expect(events.map((event) => event.result)).toEqual([AuditResult.EXITOSO, AuditResult.FALLIDO]);
      expect(events[0]).toMatchObject({ actor: host.email, detail: 'ACTIVA -> PAUSADA (pausa por el anfitrión)' });
    });
  });

  describe('CA2 · Reactivar una publicación PAUSADA', () => {
    it('vuelve a ACTIVA sin pasar por revisión y aparece de nuevo en las búsquedas', async () => {
      listings.pauseListing(listingId, host);

      const result = controller.reactivateListing(listingId, host);

      expect(result).toMatchObject({ id: listingId, status: ListingStatus.ACTIVA });
      expect((await listings.findPendingReviewQueue()).map((item) => item.id)).not.toContain(listingId);
      expect(await searchIds()).toContain(listingId);
      expect(listings.getListingDetail(listingId).id).toBe(listingId);
    });

    it('solo se reactiva una publicación PAUSADA y de su dueño', () => {
      expect(() => listings.reactivateListing(listingId, host)).toThrow(BadRequestException);
      listings.pauseListing(listingId, host);
      expect(() => listings.reactivateListing(listingId, { ...host, userId: 'otro-anfitrion' })).toThrow(NotFoundException);
      expect(listing().status).toBe(ListingStatus.PAUSADA);
      expect(statusEvents().filter((event) => event.result === AuditResult.FALLIDO)).toHaveLength(2);
    });
  });

  describe('CA3 · Las reservas confirmadas se mantienen', () => {
    it('al pausar, las reservas confirmadas siguen CONFIRMADAS con sus noches reservadas', () => {
      const booking = confirmed('confirmada');
      store.push(booking);
      listings.blockReservedPeriod(listingId, { checkIn: booking.checkIn, checkOut: booking.checkOut, bookingId: booking.id }, 'sistema');

      listings.pauseListing(listingId, host);

      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(listings.getReservedPeriods(listingId).flatMap((period) => period.blockedNights)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);

      listings.reactivateListing(listingId, host);
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
    });
  });
});
