import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
import { AuditAction } from '../../common/enums/audit.enum';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';

describe('HU-018 · Elegir la modalidad de reserva (CA1, CA2, RF-022, RN-015)', () => {
  let listings: ListingsController;
  let bookings: BookingsController;
  let listingsService: ListingsService;
  let audit: AuditService;
  let notifications: NotificationsService;

  const session = (id: string, role: Role): ActiveSession => ({
    token: `jwt-${id}`,
    userId: `user-${id}`,
    email: `${id}@stayhub.com`,
    role,
    expiresAt: Date.now() + 60_000,
  });
  const host = session('anfitrion18', Role.ANFITRION);
  const otherHost = session('otro18', Role.ANFITRION);
  const guest = session('huesped18', Role.HUESPED);

  const approvedCard = {
    cardNumber: '4242424242424242',
    cardHolder: 'Huésped HU-018',
    expMonth: 12,
    expYear: new Date().getFullYear() + 2,
    cvc: '123',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService],
    }).compile();

    listings = module.get(ListingsController);
    bookings = module.get(BookingsController);
    listingsService = module.get(ListingsService);
    audit = module.get(AuditService);
    notifications = module.get(NotificationsService);
  });

  const activeListing = async (bookingMode?: BookingMode) => {
    const listing = listings.create(
      { title: 'Finca cafetera HU-018', city: 'Manizales', pricePerNight: 180000, maxGuests: 4, bookingMode },
      host,
    );
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-06-01', endDate: '2027-06-30' }, host);
    listing.status = ListingStatus.ACTIVA;
    return listing;
  };

  const book = (listingId: string, key: string, checkIn = '2027-06-10', checkOut = '2027-06-13') =>
    bookings.createInstant({ listingId, checkIn, checkOut, guests: 2, idempotencyKey: key, card: approvedCard }, guest);

  describe('CA1 · reserva inmediata por defecto', () => {
    it('al guardar una publicación nueva su modalidad es INMEDIATA', () => {
      const listing = listings.create({ title: 'Casa nueva HU-018' }, host);

      expect(listing.bookingMode).toBe(BookingMode.INMEDIATA);
      expect(listings.findMine(host).find((item) => item.id === listing.id)?.bookingMode).toBe(BookingMode.INMEDIATA);
    });

    it('el detalle público muestra la modalidad inmediata', async () => {
      const listing = await activeListing();

      expect(listings.findOne(listing.id).bookingMode).toBe(BookingMode.INMEDIATA);
    });

    it('una publicación anterior sin modalidad guardada se trata como inmediata', async () => {
      const listing = await activeListing();
      delete listing.bookingMode;

      expect(listingsService.getBookingModeOf(listing.id)).toBe(BookingMode.INMEDIATA);
      expect((await book(listing.id, 'hu018-legacy')).status).toBe(BookingStatus.CONFIRMADA);
    });

    it('en modalidad inmediata la reserva se confirma al aprobarse el pago', async () => {
      const listing = await activeListing();

      const booking = await book(listing.id, 'hu018-inmediata');

      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(booking.bookingMode).toBe(BookingMode.INMEDIATA);
    });
  });

  describe('CA2 · con aprobación', () => {
    it('el anfitrión selecciona «con aprobación» y queda en la auditoría', async () => {
      const listing = await activeListing();

      const result = listings.updateBookingMode(listing.id, { mode: BookingMode.CON_APROBACION }, host);

      expect(result).toEqual({
        listingId: listing.id,
        bookingMode: BookingMode.CON_APROBACION,
        message: 'Las nuevas solicitudes quedarán pendientes hasta que las apruebes.',
      });
      expect(listings.findOne(listing.id).bookingMode).toBe(BookingMode.CON_APROBACION);
      expect(audit.findAll({ action: AuditAction.LISTING_UPDATE }).map((event) => event.detail)).toContain(
        'Modalidad de reserva: INMEDIATA -> CON_APROBACION',
      );
    });

    it('la nueva solicitud queda PENDIENTE_APROBACION, sin cobro ni fechas bloqueadas', async () => {
      const listing = await activeListing();
      listings.updateBookingMode(listing.id, { mode: BookingMode.CON_APROBACION }, host);

      const request = await book(listing.id, 'hu018-solicitud');

      expect(request.status).toBe(BookingStatus.PENDIENTE_APROBACION);
      expect(request.bookingMode).toBe(BookingMode.CON_APROBACION);
      expect(request.payment).toBeUndefined();
      expect(listingsService.getReservedPeriods(listing.id)).toHaveLength(0);
      expect((await bookings.findOne(request.id)).status).toBe(BookingStatus.PENDIENTE_APROBACION);
    });

    it('se puede elegir «con aprobación» desde que se crea la publicación', async () => {
      const listing = await activeListing(BookingMode.CON_APROBACION);

      expect((await book(listing.id, 'hu018-desde-creacion')).status).toBe(BookingStatus.PENDIENTE_APROBACION);
    });

    it('avisa al anfitrión que tiene una solicitud por decidir y al huésped que espera la aprobación', async () => {
      const listing = await activeListing(BookingMode.CON_APROBACION);

      const request = await book(listing.id, 'hu018-aviso');

      const hostNotice = notifications.findMine({ userId: host.userId });
      expect(hostNotice[0]).toEqual(expect.objectContaining({ type: 'SOLICITUD_RESERVA', entityId: request.id }));
      expect(hostNotice[0].message).toContain('espera tu aprobación');
      expect(notifications.findMine({ email: guest.email })[0].message).toContain('El anfitrión debe aprobarla');
    });

    it('la solicitud no se puede pagar hasta que el anfitrión decida', async () => {
      const listing = await activeListing(BookingMode.CON_APROBACION);
      const request = await book(listing.id, 'hu018-pago');

      await expect(bookings.payBooking(request.id, approvedCard, guest)).rejects.toThrow(ConflictException);
      expect((await bookings.findOne(request.id)).status).toBe(BookingStatus.PENDIENTE_APROBACION);
    });

    it('volver a «reserva inmediata» aplica a las nuevas reservas y no cambia las solicitudes pendientes', async () => {
      const listing = await activeListing(BookingMode.CON_APROBACION);
      const request = await book(listing.id, 'hu018-antes');

      const result = listings.updateBookingMode(listing.id, { mode: BookingMode.INMEDIATA }, host);
      const booking = await book(listing.id, 'hu018-despues', '2027-06-20', '2027-06-22');

      expect(result.message).toBe('Las nuevas reservas se confirmarán de inmediato al aprobarse el pago.');
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect((await bookings.findOne(request.id)).status).toBe(BookingStatus.PENDIENTE_APROBACION);
    });

    it('también se cambia al editar la publicación', async () => {
      const listing = await activeListing();

      listings.update(listing.id, { bookingMode: BookingMode.CON_APROBACION }, host);

      expect(listingsService.getBookingModeOf(listing.id)).toBe(BookingMode.CON_APROBACION);
    });

    it('solo el anfitrión propietario cambia la modalidad', async () => {
      const listing = await activeListing();

      expect(() => listings.updateBookingMode(listing.id, { mode: BookingMode.CON_APROBACION }, otherHost)).toThrow(NotFoundException);
      expect(listingsService.getBookingModeOf(listing.id)).toBe(BookingMode.INMEDIATA);
    });

    it('rechaza una modalidad que no existe', async () => {
      const listing = await activeListing();

      expect(() => listings.updateBookingMode(listing.id, { mode: 'LIBRE' as BookingMode }, host)).toThrow(BadRequestException);
    });
  });
});
