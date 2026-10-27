import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';

describe('HU-030 · Reservar de forma inmediata (CA1, CA2, CA3, CA4, RF-041, RF-045, RF-046, RN-006, RN-015, RNF-008)', () => {
  let bookings: BookingsController;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let platform: PlatformConfigService;

  const host: ActiveSession = {
    token: 'jwt-host-30',
    userId: 'user-host-30',
    email: 'anfitrion30@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const guest: ActiveSession = {
    token: 'jwt-guest-30',
    userId: 'user-guest-30',
    email: 'huesped30@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 60_000,
  };

  const approvedCard = {
    cardNumber: '4242424242424242',
    cardHolder: 'Huésped HU-030',
    expMonth: 12,
    expYear: new Date().getFullYear() + 2,
    cvc: '123',
  };

  const declinedCard = {
    cardNumber: '4000000000000002',
    cardHolder: 'Huésped HU-030',
    expMonth: 12,
    expYear: new Date().getFullYear() + 2,
    cvc: '123',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookings = module.get(BookingsController);
    listings = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    platform = module.get(PlatformConfigService);
    platform.updateServiceFee({ serviceFeePercent: 10 }, 'admin@stayhub.com');
  });

  const setupActiveListing = async () => {
    const listing = listings.create({ title: 'Apartamento Inmediato HU-030', city: 'Cartagena', pricePerNight: 200000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-05-01', endDate: '2027-05-30' }, host);
    listings.updatePricing(listing.id, { cleaningFee: 50000, longStayDiscountPercent: 10, longStayMinNights: 7 }, host);
    listing.status = ListingStatus.ACTIVA;
    return listing;
  };

  it('CA1 · con cotización vigente y pago simulado aprobado, la reserva queda CONFIRMADA con código y desglose', async () => {
    const listing = await setupActiveListing();

    const booking = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-05-10',
        checkOut: '2027-05-13',
        guests: 2,
        idempotencyKey: 'ca1-idempotency-key',
        card: approvedCard,
      },
      guest,
    );

    expect(booking.status).toBe(BookingStatus.CONFIRMADA);
    expect(booking.code).toMatch(/^RES-[0-9A-F]{8}$/);
    expect(booking.nights).toBe(3);
    expect(booking.nightlyRate).toBe(200000);
    expect(booking.baseAmount).toBe(600000);
    expect(booking.cleaningFee).toBe(50000);
    expect(booking.serviceFee).toBe(65000);
    expect(booking.totalAmount).toBe(715000);
    expect(booking.currency).toBe('COP');
    expect(booking.breakdown).toBeDefined();
    expect(booking.payment?.reference).toMatch(/^TEST-/);
    expect(listingsService.getReservedPeriods(listing.id)).toHaveLength(1);
  });

  it('CA2 · al consultar el detalle de la reserva confirmada, conserva el desglose vigente al momento de confirmar', async () => {
    const listing = await setupActiveListing();

    const created = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-05-10',
        checkOut: '2027-05-13',
        guests: 2,
        idempotencyKey: 'ca2-idempotency-key',
        card: approvedCard,
      },
      guest,
    );

    // Cambiamos tarifas posteriores en la plataforma y en la publicación
    platform.updateServiceFee({ serviceFeePercent: 18 }, 'admin@stayhub.com');
    listings.updatePricing(listing.id, { cleaningFee: 99000 }, host);
    listing.pricePerNight = 500000;

    // Consultamos el detalle de la reserva
    const detail = await bookings.findOne(created.id);

    expect(detail.id).toBe(created.id);
    expect(detail.status).toBe(BookingStatus.CONFIRMADA);
    expect(detail.code).toBe(created.code);
    expect(detail.serviceFee).toBe(65000); // 10% histórico conservado, no 18%
    expect(detail.cleaningFee).toBe(50000); // 50.000 histórico conservado, no 99.000
    expect(detail.totalAmount).toBe(715000);
    expect(detail.breakdown?.serviceFeePercentage).toBe(10);
  });

  it('CA3 · si la publicación dejó de estar ACTIVA, rechaza la reserva', async () => {
    const listing = await setupActiveListing();
    listing.status = ListingStatus.PAUSADA; // Dejó de estar ACTIVA

    await expect(
      bookings.createInstant(
        {
          listingId: listing.id,
          checkIn: '2027-05-10',
          checkOut: '2027-05-13',
          guests: 2,
          idempotencyKey: 'ca3-idempotency-key',
          card: approvedCard,
        },
        guest,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('CA1/HU-037 · si el pago con tarjeta simulada es rechazado, la reserva queda PENDIENTE y no bloquea fechas', async () => {
    const listing = await setupActiveListing();

    const booking = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-05-10',
        checkOut: '2027-05-13',
        guests: 2,
        idempotencyKey: 'declined-pay-idempotency',
        card: declinedCard,
      },
      guest,
    );

    expect(booking.status).toBe(BookingStatus.PENDIENTE);
    expect(listingsService.getReservedPeriods(listing.id)).toHaveLength(0);
    expect(booking.payment?.status).toBe('RECHAZADO');
  });

  it('respeta la clave de idempotencia devolviendo la misma reserva', async () => {
    const listing = await setupActiveListing();

    const first = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-05-10',
        checkOut: '2027-05-13',
        guests: 2,
        idempotencyKey: 'idempotent-repeat',
      },
      guest,
    );

    const second = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-05-10',
        checkOut: '2027-05-13',
        guests: 2,
        idempotencyKey: 'idempotent-repeat',
      },
      guest,
    );

    expect(second.id).toBe(first.id);
  });
});
