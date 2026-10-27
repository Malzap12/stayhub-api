import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { AuditResult } from '../../common/enums/audit.enum';

describe('HU-037 · Pagar la reserva en modo de pruebas (CA1, CA2, CA3, RF-051, RF-052, RN-022)', () => {
  let bookings: BookingsController;
  let bookingsService: BookingsService;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let audit: AuditService;

  const host: ActiveSession = {
    token: 'jwt-host-37',
    userId: 'user-host-37',
    email: 'anfitrion37@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };
  const guest: ActiveSession = {
    token: 'jwt-guest-37',
    userId: 'user-guest-37',
    email: 'huesped37@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 60_000,
  };

  const card = (cardNumber: string): PaymentCardDto => ({
    cardNumber,
    cardHolder: 'Huésped de Prueba',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookings = module.get(BookingsController);
    bookingsService = module.get(BookingsService);
    listings = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    audit = module.get(AuditService);
  });

  const pendingBooking = async () => {
    const listing = listings.create({ title: 'Cabaña HU-037', city: 'Medellín', pricePerNight: 200000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-02-01', endDate: '2027-04-30' }, host);
    listing.status = ListingStatus.ACTIVA;
    const booking = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-03-01',
        checkOut: '2027-03-04',
        guests: 2,
        idempotencyKey: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      },
      guest,
    );
    return { listingId: listing.id, booking };
  };

  it('CA1 · con una tarjeta aprobada el pago queda APROBADO con referencia y la reserva se confirma', async () => {
    const { listingId, booking } = await pendingBooking();

    const result = await bookings.payBooking(booking.id, card('4242424242424242'), guest);

    expect(result.payment).toMatchObject({ status: PaymentStatus.APROBADO, bookingId: booking.id, mode: 'TEST' });
    expect(result.payment.reference).toMatch(/^TEST-/);
    expect(result.booking.status).toBe(BookingStatus.CONFIRMADA);
    expect(result.booking.payment?.reference).toBe(result.payment.reference);
    expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
    expect(listingsService.unavailableNights(listingId, '2027-03-01', '2027-03-04')).toEqual([
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
    ]);
  });

  it('CA2 · con una tarjeta rechazada el pago queda RECHAZADO, la reserva no se confirma y las fechas no se bloquean', async () => {
    const { listingId, booking } = await pendingBooking();

    const result = await bookings.payBooking(booking.id, card('4000000000000002'), guest);

    expect(result.payment).toMatchObject({ status: PaymentStatus.RECHAZADO, declineReason: 'TARJETA_RECHAZADA' });
    expect(result.booking.status).toBe(BookingStatus.PENDIENTE);
    expect(listingsService.getReservedPeriods(listingId)).toHaveLength(0);
    expect(listingsService.unavailableNights(listingId, '2027-03-01', '2027-03-04')).toEqual([]);
    expect(audit.findAll().some((event) => event.entityId === booking.id && event.result === AuditResult.FALLIDO)).toBe(true);
  });

  it('CA2 · tras un rechazo, el huésped puede reintentar con otra tarjeta de prueba', async () => {
    const { booking } = await pendingBooking();
    await bookings.payBooking(booking.id, card('4000000000009995'), guest);

    const retry = await bookings.payBooking(booking.id, card('5555 5555 5555 4444'), guest);

    expect(retry.payment.status).toBe(PaymentStatus.APROBADO);
    expect(retry.booking.status).toBe(BookingStatus.CONFIRMADA);
  });

  it('no permite pagar dos veces una reserva confirmada', async () => {
    const { booking } = await pendingBooking();
    await bookings.payBooking(booking.id, card('4242424242424242'), guest);

    await expect(bookings.payBooking(booking.id, card('4242424242424242'), guest)).rejects.toThrow(ConflictException);
  });

  it('no cobra si el periodo ya no está disponible', async () => {
    const { listingId, booking } = await pendingBooking();
    listingsService.blockReservedPeriod(listingId, { checkIn: '2027-03-02', checkOut: '2027-03-03', bookingId: 'otra' }, host.email);

    await expect(bookings.payBooking(booking.id, card('4242424242424242'), guest)).rejects.toThrow(BadRequestException);
    expect((await bookings.findOne(booking.id)).payment).toBeUndefined();
  });

  it('no paga reservas canceladas ni inexistentes', async () => {
    const { booking } = await pendingBooking();
    booking.status = BookingStatus.CANCELADA;

    await expect(bookings.payBooking(booking.id, card('4242424242424242'), guest)).rejects.toThrow(BadRequestException);
    await expect(bookings.payBooking('no-existe', card('4242424242424242'), guest)).rejects.toThrow(NotFoundException);
  });

  it('CA3 · sin proveedor de pagos disponible no se confirma la reserva', async () => {
    const { booking } = await pendingBooking();
    const withoutPayments = new BookingsService(audit, listingsService);
    (withoutPayments as unknown as { bookingsStore: unknown[] }).bookingsStore = [booking];

    await expect(withoutPayments.payBooking(booking.id, card('4242424242424242'))).rejects.toThrow(ServiceUnavailableException);
    expect(bookingsService).toBeDefined();
  });
});
