import { Test, TestingModule } from '@nestjs/testing';
import { BookingsController } from './bookings.controller';
import { arrivalInstant, BookingsService, calculatePolicyRefund } from './bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { CANCELLATION_POLICIES } from '../listings/cancellation-policies';

describe('HU-041 · Calcular la devolución según la política (CA1, CA2, CA3, RF-054, RN-016, RN-030, RNF-024)', () => {
  let bookings: BookingsController;
  let listings: ListingsController;
  let platformConfig: PlatformConfigService;
  let listingId: string;
  let keySeq = 0;

  const host: ActiveSession = {
    token: 'jwt-host-hu041',
    userId: 'host-hu041',
    email: 'anfitrion41@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 3_600_000,
  };
  const guest: ActiveSession = {
    token: 'jwt-guest-hu041',
    userId: 'guest-hu041',
    email: 'huesped41@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 3_600_000,
  };

  const card: PaymentCardDto = {
    cardNumber: '4242424242424242',
    cardHolder: 'Huésped HU-041',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  };

  const CHECK_IN = '2027-04-10';
  const CHECK_OUT = '2027-04-13';
  const ARRIVAL = arrivalInstant(CHECK_IN);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookings = module.get(BookingsController);
    listings = module.get(ListingsController);
    platformConfig = module.get(PlatformConfigService);

    // Configura reserva exacta de 715.000 COP: 3 noches * 200.000 = 600.000 + limpieza 50.000 = 650.000; tarifa 10 % = 65.000 -> total 715.000 COP
    platformConfig.updateServiceFee({ serviceFeePercent: 10 }, 'admin@inversioneslr.com');
    const created = listings.create(
      {
        title: 'Apartamento HU-041',
        city: 'Bogotá',
        pricePerNight: 200000,
        maxGuests: 4,
        cancellationPolicy: 'FLEXIBLE',
      },
      host,
    );
    listings.updatePricing(created.id, { cleaningFee: 50000, longStayDiscountPercent: 0 }, host);
    await listings.registerAvailabilityPeriod(created.id, { startDate: '2027-04-01', endDate: '2027-04-30' }, host);
    created.status = ListingStatus.ACTIVA;
    listingId = created.id;
  });

  afterEach(() => jest.restoreAllMocks());

  const create715kBooking = async () => {
    const booking = await bookings.createInstant(
      {
        listingId,
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        guests: 2,
        idempotencyKey: `41000000-0000-4000-8000-${String(++keySeq).padStart(12, '0')}`,
        card,
      },
      guest,
    );
    expect(booking.totalAmount).toBe(715000);
    expect(booking.serviceFee).toBe(65000);
    return booking;
  };

  it('CA1: reserva de 715.000 COP con tarifa de servicio de 65.000 COP y política Flexible cancelada 5 días antes devuelve 650.000 COP (100 % sin tarifa de servicio)', async () => {
    const booking = await create715kBooking();
    jest.spyOn(Date, 'now').mockReturnValue(ARRIVAL - 5 * DAY);

    const cancelled = await bookings.cancelBooking(booking.id, { reason: 'Cambio de fechas del viaje' }, guest);

    expect(cancelled.cancellation).toMatchObject({
      policy: 'FLEXIBLE',
      refundableAmount: 650000,
      refundPercentage: 100,
      refundAmount: 650000,
      currency: 'COP',
    });
  });

  it('CA2: la misma reserva de 715.000 COP cancelada 24 horas antes de la llegada devuelve 325.000 COP (50 %)', async () => {
    const booking = await create715kBooking();
    jest.spyOn(Date, 'now').mockReturnValue(ARRIVAL - 24 * HOUR);

    const cancelled = await bookings.cancelBooking(booking.id, { reason: 'Imprevisto de última hora' }, guest);

    expect(cancelled.cancellation).toMatchObject({
      policy: 'FLEXIBLE',
      refundableAmount: 650000,
      refundPercentage: 50,
      refundAmount: 325000,
      currency: 'COP',
    });
  });

  it('CA3: al ver el detalle de la cancelación se muestran el valor devuelto y la regla aplicada', async () => {
    const booking = await create715kBooking();
    jest.spyOn(Date, 'now').mockReturnValue(ARRIVAL - 24 * HOUR);
    await bookings.cancelBooking(booking.id, { reason: 'Consulta de detalle de cancelación' }, guest);

    const detail = await bookings.findOne(booking.id);

    expect(detail.cancellation?.refundAmount).toBe(325000);
    expect(detail.cancellation?.appliedRule).toBe(
      'Política Flexible: 50 % de devolución (sin la tarifa de servicio) por cancelar con menos de 48 h de anticipación a la llegada',
    );

    const direct100 = calculatePolicyRefund(715000, 65000, 120, CANCELLATION_POLICIES.FLEXIBLE);
    expect(direct100).toEqual({
      policy: 'FLEXIBLE',
      refundableAmount: 650000,
      refundPercentage: 100,
      refundAmount: 650000,
      appliedRule: 'Política Flexible: 100 % de devolución (sin la tarifa de servicio) por cancelar al menos 48 h antes de la llegada',
    });
  });
});
