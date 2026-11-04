import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingsController } from '../bookings/bookings.controller';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';

describe('HU-021 · Bloquear fechas manualmente (CA1, CA2, RF-027, RN-004)', () => {
  let listings: ListingsController;
  let bookings: BookingsController;
  let audit: AuditService;

  const year = new Date().getFullYear() + 1;
  const day = (month: number, date: number) => `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const session = (id: string, role: Role): ActiveSession => ({
    token: `jwt-${id}`,
    userId: `user-${id}`,
    email: `${id}@stayhub.com`,
    role,
    expiresAt: Date.now() + 60_000,
  });
  const host = session('anfitrion21', Role.ANFITRION);
  const otherHost = session('otro21', Role.ANFITRION);
  const guest = session('huesped21', Role.HUESPED);
  const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped HU-021', expMonth: 12, expYear: year + 2, cvc: '123' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService],
    }).compile();

    listings = module.get(ListingsController);
    bookings = module.get(BookingsController);
    audit = module.get(AuditService);
  });

  const activeListing = async () => {
    const listing = listings.create({ title: 'Casa de campo HU-021', city: 'Guatapé', pricePerNight: 250000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: day(3, 1), endDate: day(3, 31) }, host);
    listing.status = ListingStatus.ACTIVA;
    return listing;
  };
  const quote = (listingId: string, checkIn: string, checkOut: string) => bookings.quote({ listingId, checkIn, checkOut, guests: 2 });
  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as BadRequestException).getResponse();
    }
    throw new Error('Se esperaba un error');
  };

  describe('CA1 · bloquear', () => {
    it('bloquea las noches indicadas, ambas incluidas, con una nota privada', async () => {
      const listing = await activeListing();

      const block = listings.blockDates(listing.id, { startDate: day(3, 10), endDate: day(3, 12), note: ' Mantenimiento ' }, host);

      expect(block).toEqual(
        expect.objectContaining({
          type: 'BLOQUEO',
          checkIn: day(3, 10),
          checkOut: day(3, 13),
          blockedNights: [day(3, 10), day(3, 11), day(3, 12)],
          note: 'Mantenimiento',
        }),
      );
      expect(listings.getBlockedDates(listing.id, host)).toEqual([block]);
      expect(listings.getReservedPeriods(listing.id)[0]).not.toHaveProperty('note');
      expect(audit.findAll({ action: AuditAction.RESERVED_PERIOD_BLOCK, result: AuditResult.EXITOSO }).map((event) => event.detail)).toContain(
        `Fechas bloqueadas por el anfitrión: noches ${day(3, 10)}, ${day(3, 11)}, ${day(3, 12)} (Mantenimiento)`,
      );
    });

    it('las fechas bloqueadas no se pueden cotizar ni reservar y salen como no disponibles', async () => {
      const listing = await activeListing();
      listings.blockDates(listing.id, { startDate: day(3, 10), endDate: day(3, 10) }, host);

      await expect(quote(listing.id, day(3, 9), day(3, 11))).rejects.toMatchObject({
        response: expect.objectContaining({ reason: 'PERIODO_NO_DISPONIBLE', unavailableNights: [day(3, 10)] }),
      });
      await expect(
        bookings.createInstant({ listingId: listing.id, checkIn: day(3, 10), checkOut: day(3, 12), guests: 2, idempotencyKey: 'hu021-reserva', card }, guest),
      ).rejects.toThrow(BadRequestException);
      expect(listings.getAvailability(listing.id, { startDate: day(3, 9), endDate: day(3, 12) })).toEqual(
        expect.objectContaining({ isAvailable: false, blockedDates: [day(3, 10)] }),
      );
      expect((await quote(listing.id, day(3, 11), day(3, 13))).nights).toBe(2);
    });

    it('no bloquea fechas con reservas ni fechas ya bloqueadas', async () => {
      const listing = await activeListing();
      const booking = await bookings.createInstant(
        { listingId: listing.id, checkIn: day(3, 5), checkOut: day(3, 7), guests: 2, idempotencyKey: 'hu021-confirmada', card },
        guest,
      );
      expect(booking.status).toBe('CONFIRMADA');
      listings.blockDates(listing.id, { startDate: day(3, 20), endDate: day(3, 21) }, host);

      expect(reason(() => listings.blockDates(listing.id, { startDate: day(3, 6), endDate: day(3, 8) }, host))).toEqual(
        expect.objectContaining({ reason: 'FECHAS_OCUPADAS', reservedDates: [day(3, 6)], blockedDates: [] }),
      );
      expect(reason(() => listings.blockDates(listing.id, { startDate: day(3, 21), endDate: day(3, 22) }, host))).toEqual(
        expect.objectContaining({ reason: 'FECHAS_OCUPADAS', reservedDates: [], blockedDates: [day(3, 21)] }),
      );
    });

    it('rechaza fechas invertidas, pasadas o fuera de los periodos disponibles', async () => {
      const listing = await activeListing();

      expect(reason(() => listings.blockDates(listing.id, { startDate: day(3, 12), endDate: day(3, 10) }, host))).toEqual(
        expect.objectContaining({ reason: 'FECHAS_INVALIDAS' }),
      );
      expect(reason(() => listings.blockDates(listing.id, { startDate: '2020-01-01', endDate: '2020-01-02' }, host))).toEqual(
        expect.objectContaining({ reason: 'FECHA_PASADA' }),
      );
      expect(reason(() => listings.blockDates(listing.id, { startDate: day(3, 30), endDate: day(4, 1) }, host))).toEqual(
        expect.objectContaining({ reason: 'FUERA_DE_DISPONIBILIDAD', outsideDates: [day(3, 31), day(4, 1)] }),
      );
      expect(listings.getBlockedDates(listing.id, host)).toEqual([]);
    });

    it('solo el anfitrión dueño bloquea y consulta sus bloqueos', async () => {
      const listing = await activeListing();

      expect(() => listings.blockDates(listing.id, { startDate: day(3, 10), endDate: day(3, 10) }, otherHost)).toThrow(NotFoundException);
      expect(() => listings.getBlockedDates(listing.id, otherHost)).toThrow(NotFoundException);
    });
  });

  describe('CA2 · desbloquear', () => {
    it('al desbloquear las fechas vuelven a estar disponibles y se puede reservar', async () => {
      const listing = await activeListing();
      const block = listings.blockDates(listing.id, { startDate: day(3, 10), endDate: day(3, 11) }, host);

      const result = listings.unblockDates(listing.id, block.id, host);

      expect(result).toEqual({
        listingId: listing.id,
        blockId: block.id,
        releasedNights: [day(3, 10), day(3, 11)],
        message: 'Las fechas volvieron a estar disponibles para reservar.',
      });
      expect(listings.getBlockedDates(listing.id, host)).toEqual([]);
      expect(listings.getAvailability(listing.id, { startDate: day(3, 10), endDate: day(3, 12) }).isAvailable).toBe(true);
      const booking = await bookings.createInstant(
        { listingId: listing.id, checkIn: day(3, 10), checkOut: day(3, 12), guests: 2, idempotencyKey: 'hu021-tras-desbloquear', card },
        guest,
      );
      expect(booking.status).toBe('CONFIRMADA');
      expect(audit.findAll({ action: AuditAction.RESERVED_PERIOD_UNBLOCK }).map((event) => event.detail)).toEqual([
        `Fechas desbloqueadas por el anfitrión: noches ${day(3, 10)}, ${day(3, 11)}`,
      ]);
    });

    it('no desbloquea las noches de una reserva, un bloqueo inexistente ni el de otro anfitrión', async () => {
      const listing = await activeListing();
      await bookings.createInstant(
        { listingId: listing.id, checkIn: day(3, 5), checkOut: day(3, 7), guests: 2, idempotencyKey: 'hu021-no-desbloquear', card },
        guest,
      );
      const reservation = listings.getReservedPeriods(listing.id)[0];
      const block = listings.blockDates(listing.id, { startDate: day(3, 10), endDate: day(3, 10) }, host);

      expect(() => listings.unblockDates(listing.id, reservation.id, host)).toThrow(NotFoundException);
      expect(() => listings.unblockDates(listing.id, 'bloqueo-inexistente', host)).toThrow(NotFoundException);
      expect(() => listings.unblockDates(listing.id, block.id, otherHost)).toThrow(NotFoundException);
      expect(listings.getReservedPeriods(listing.id)).toHaveLength(2);
    });
  });
});
