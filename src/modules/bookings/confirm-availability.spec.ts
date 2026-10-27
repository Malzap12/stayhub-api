import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingResponseDto } from './dto/booking-response.dto';

describe('HU-031 · Verificar la disponibilidad al confirmar (CA1, CA2, RF-042, RF-043, RN-011, RN-012, RNF-009, RNF-010)', () => {
  let bookings: BookingsController;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let payments: PaymentsService;
  let audit: AuditService;
  let chargeSpy: jest.SpyInstance;
  let listingId: string;
  let keySequence = 0;

  const session = (role: Role, name: string): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role,
    expiresAt: Date.now() + 60_000,
  });
  const host = session(Role.ANFITRION, 'anfitrion31');
  const guestA = session(Role.HUESPED, 'huesped31a');
  const guestB = session(Role.HUESPED, 'huesped31b');

  const approvedCard: PaymentCardDto = {
    cardNumber: '4242424242424242',
    cardHolder: 'Huésped de Prueba',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  };

  const activeListing = async (title: string) => {
    const listing = listings.create({ title, city: 'Santa Fe de Antioquia', pricePerNight: 250000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-05-01', endDate: '2027-05-31' }, host);
    listing.status = ListingStatus.ACTIVA;
    return listing.id;
  };

  /** Cotiza y crea la reserva PENDIENTE (HU-030) sin pagarla todavía. */
  const book = (checkIn: string, checkOut: string, guest = guestA, listing = listingId) =>
    bookings.createInstant(
      { listingId: listing, checkIn, checkOut, guests: 2, idempotencyKey: `00000000-0000-4000-8031-${String(++keySequence).padStart(12, '0')}` },
      guest,
    );

  const pay = (booking: BookingResponseDto, guest = guestA) => bookings.payBooking(booking.id, approvedCard, guest);

  const rejectionOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as Record<string, unknown>;
    }
    throw new Error('Se esperaba un rechazo 400');
  };

  const chargesFor = (booking: BookingResponseDto) =>
    chargeSpy.mock.calls.filter(([request]) => request.bookingId === booking.id).length;

  /** El proveedor responde de forma asíncrona, como uno real, para que las solicitudes simultáneas se puedan intercalar. */
  const slowProvider = () => {
    const charge = PaymentsService.prototype.charge.bind(payments);
    chargeSpy.mockImplementation(
      (async (request: Parameters<PaymentsService['charge']>[0]) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return charge(request);
      }) as never,
    );
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookings = module.get(BookingsController);
    listings = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    payments = module.get(PaymentsService);
    audit = module.get(AuditService);
    chargeSpy = jest.spyOn(payments, 'charge');
    listingId = await activeListing('Casa del Río');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('CA1 · Otro huésped confirmó el mismo periodo después de mi cotización', () => {
    it('rechaza mi reserva porque el periodo ya no está disponible y no hace el cobro simulado', async () => {
      const mine = await book('2027-05-10', '2027-05-14', guestA);
      const other = await book('2027-05-10', '2027-05-14', guestB);
      await pay(other, guestB);

      const rejection = await rejectionOf(pay(mine, guestA));

      expect(rejection).toMatchObject({
        statusCode: 400,
        reason: 'PERIODO_NO_DISPONIBLE',
        message: 'El periodo del 2027-05-10 al 2027-05-14 ya no está disponible en esta publicación',
        unavailableNights: ['2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13'],
      });
      expect(chargesFor(mine)).toBe(0);
      expect(mine.status).toBe(BookingStatus.PENDIENTE);
      expect(mine.payment).toBeUndefined();
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
    });

    it('también rechaza al reservar y pagar en un solo paso (HU-030) sin cobrar', async () => {
      const other = await book('2027-05-10', '2027-05-14', guestB);
      await pay(other, guestB);

      const rejection = await rejectionOf(
        bookings.createInstant(
          { listingId, checkIn: '2027-05-12', checkOut: '2027-05-15', guests: 2, idempotencyKey: '00000000-0000-4000-8031-999999999999', card: approvedCard },
          guestA,
        ),
      );

      expect(rejection.reason).toBe('PERIODO_NO_DISPONIBLE');
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it('indica solo las noches que se tomaron cuando el solapamiento es parcial', async () => {
      const other = await book('2027-05-12', '2027-05-16', guestB);
      const mine = await book('2027-05-10', '2027-05-14', guestA);
      await pay(other, guestB);

      const rejection = await rejectionOf(pay(mine));
      expect(rejection.unavailableNights).toEqual(['2027-05-12', '2027-05-13']);
    });

    it('rechaza también si el anfitrión bloqueó noches después de la cotización', async () => {
      const mine = await book('2027-05-20', '2027-05-23');
      listings.blockReservedPeriod(listingId, { checkIn: '2027-05-22', checkOut: '2027-05-24' }, host);

      const rejection = await rejectionOf(pay(mine));
      expect(rejection.unavailableNights).toEqual(['2027-05-22']);
      expect(chargesFor(mine)).toBe(0);
    });

    it('la confirmación directa (HU-023) también verifica de nuevo la disponibilidad', async () => {
      const mine = await book('2027-05-10', '2027-05-12');
      const other = await book('2027-05-10', '2027-05-12', guestB);
      await bookings.confirmBooking(other.id, host);

      const rejection = await rejectionOf(bookings.confirmBooking(mine.id, host));
      expect(rejection.reason).toBe('PERIODO_NO_DISPONIBLE');
      expect(mine.status).toBe(BookingStatus.PENDIENTE);
    });

    it('confirma si el periodo sigue libre: el día de salida de otra reserva puede ser la llegada', async () => {
      const other = await book('2027-05-05', '2027-05-10', guestB);
      const mine = await book('2027-05-10', '2027-05-12');
      await pay(other, guestB);

      const result = await pay(mine);

      expect(result.booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(result.payment.status).toBe(PaymentStatus.APROBADO);
      expect(chargesFor(mine)).toBe(1);
    });

    it('audita el rechazo como FALLIDO indicando que no hubo cobro', async () => {
      const mine = await book('2027-05-10', '2027-05-12');
      const other = await book('2027-05-10', '2027-05-12', guestB);
      await pay(other, guestB);
      await rejectionOf(pay(mine));

      const events = audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE, entity: 'Booking' });
      expect(events.find((event) => event.entityId === mine.id && event.result === AuditResult.FALLIDO)).toMatchObject({
        actor: guestA.email,
        detail: 'Confirmación rechazada: periodo no disponible (noches 2027-05-10, 2027-05-11); no se hizo el cobro',
      });
    });
  });

  describe('CA2 · Solicitudes simultáneas para el mismo alojamiento y periodo (prueba de concurrencia)', () => {
    it('con dos pagos simultáneos, como máximo una reserva queda CONFIRMADA y solo ella se cobra', async () => {
      slowProvider();
      const first = await book('2027-05-10', '2027-05-14', guestA);
      const second = await book('2027-05-10', '2027-05-14', guestB);

      const results = await Promise.allSettled([pay(first, guestA), pay(second, guestB)]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected.reason).toBeInstanceOf(BadRequestException);
      expect([first.status, second.status].sort()).toEqual([BookingStatus.CONFIRMADA, BookingStatus.PENDIENTE]);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
    });

    it('con N solicitudes simultáneas sobre periodos que se solapan, una sola se confirma', async () => {
      slowProvider();
      const ranges: [string, string][] = [
        ['2027-05-10', '2027-05-14'],
        ['2027-05-11', '2027-05-13'],
        ['2027-05-12', '2027-05-15'],
        ['2027-05-09', '2027-05-11'],
        ['2027-05-13', '2027-05-14'],
        ['2027-05-10', '2027-05-14'],
        ['2027-05-08', '2027-05-16'],
        ['2027-05-10', '2027-05-14'],
      ];
      const pending = await Promise.all(ranges.map(([checkIn, checkOut], index) => book(checkIn, checkOut, index % 2 ? guestA : guestB)));

      const results = await Promise.allSettled(pending.map((booking) => pay(booking)));

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(pending.filter((booking) => booking.status === BookingStatus.CONFIRMADA)).toHaveLength(1);
      expect(chargeSpy).toHaveBeenCalledTimes(1);
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
    });

    it('pagos y confirmaciones directas simultáneos sobre el mismo periodo tampoco se superponen', async () => {
      slowProvider();
      const paid = await book('2027-05-10', '2027-05-14', guestA);
      const confirmed = await book('2027-05-12', '2027-05-16', guestB);

      const results = await Promise.allSettled([pay(paid), bookings.confirmBooking(confirmed.id, host)]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
    });

    it('las noches que no se solapan sí se confirman aunque lleguen al mismo tiempo', async () => {
      slowProvider();
      const pending = await Promise.all([book('2027-05-01', '2027-05-03'), book('2027-05-03', '2027-05-05', guestB), book('2027-05-05', '2027-05-08')]);

      const results = await Promise.all(pending.map((booking) => pay(booking)));

      expect(results.every((result) => result.booking.status === BookingStatus.CONFIRMADA)).toBe(true);
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(3);
    });

    it('confirmaciones simultáneas en alojamientos distintos no se bloquean entre sí', async () => {
      slowProvider();
      const otherListing = await activeListing('Casa del Valle');
      const here = await book('2027-05-10', '2027-05-12');
      const there = await book('2027-05-10', '2027-05-12', guestB, otherListing);

      const results = await Promise.all([pay(here), pay(there, guestB)]);
      expect(results.map((result) => result.booking.status)).toEqual([BookingStatus.CONFIRMADA, BookingStatus.CONFIRMADA]);
    });

    it('la misma reserva pagada dos veces a la vez se cobra una sola vez', async () => {
      slowProvider();
      const mine = await book('2027-05-10', '2027-05-12');

      const results = await Promise.allSettled([pay(mine), pay(mine)]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(chargesFor(mine)).toBe(1);
      expect(mine.status).toBe(BookingStatus.CONFIRMADA);
    });

    it('confirmar dos veces la misma reserva la devuelve igual sin bloquear las noches otra vez', async () => {
      const mine = await book('2027-05-10', '2027-05-12');
      const [first, second] = await Promise.all([bookings.confirmBooking(mine.id, host), bookings.confirmBooking(mine.id, host)]);

      expect(second).toBe(first);
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
    });
  });

  describe('RNF-009 · La verificación, el cobro y el bloqueo se completan juntos o no se completan', () => {
    it('si el bloqueo de noches falla después del pago aprobado, revierte el pago y la reserva sigue PENDIENTE', async () => {
      const mine = await book('2027-05-10', '2027-05-12');
      jest.spyOn(listingsService, 'blockReservedPeriod').mockImplementationOnce(() => {
        throw new Error('fallo inducido al bloquear');
      });

      await expect(pay(mine)).rejects.toThrow('fallo inducido al bloquear');

      expect(mine.status).toBe(BookingStatus.PENDIENTE);
      expect(mine.payment?.status).toBe(PaymentStatus.REVERTIDO);
      expect(listingsService.getReservedPeriods(listingId)).toEqual([]);
      const events = audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE, entity: 'Booking' });
      expect(events.at(-1)).toMatchObject({
        entityId: mine.id,
        result: AuditResult.FALLIDO,
        detail: expect.stringContaining('se revirtió porque no se pudieron bloquear las noches'),
      });
    });

    it('después de un fallo, el alojamiento sigue aceptando pagos y la misma reserva se puede reintentar', async () => {
      const mine = await book('2027-05-10', '2027-05-12');
      jest.spyOn(listingsService, 'blockReservedPeriod').mockImplementationOnce(() => {
        throw new Error('fallo inducido al bloquear');
      });
      await expect(pay(mine)).rejects.toThrow();

      const retried = await pay(mine);
      expect(retried.booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(retried.payment.status).toBe(PaymentStatus.APROBADO);
    });

    it('una reserva que no está PENDIENTE no se confirma', async () => {
      const mine = await book('2027-05-10', '2027-05-12');
      mine.status = BookingStatus.CANCELADA;

      await expect(bookings.confirmBooking(mine.id, host)).rejects.toThrow(
        'Solo se pueden confirmar reservas pendientes (estado actual: CANCELADA)',
      );
      expect(listingsService.getReservedPeriods(listingId)).toEqual([]);
    });
  });
});
