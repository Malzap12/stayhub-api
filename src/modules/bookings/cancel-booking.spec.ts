import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingsController } from './bookings.controller';
import { arrivalInstant, BookingsService } from './bookings.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { rowsToSource, sourceToRows } from '../persistence/state-tables';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-040 · Cancelar mi reserva (CA1, CA2, CA3, RF-053, RF-055, RF-056, RN-017, RN-021, RN-029)', () => {
  let bookings: BookingsController;
  let bookingsService: BookingsService;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let audit: AuditService;
  let listingId: string;
  let keySequence = 0;

  const session = (role: Role, name: string): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role,
    expiresAt: Date.now() + 3_600_000,
  });
  const host = session(Role.ANFITRION, 'anfitrion40');
  const guest = session(Role.HUESPED, 'huesped40');
  const otherGuest = session(Role.HUESPED, 'huesped40b');

  const card: PaymentCardDto = {
    cardNumber: '4242424242424242',
    cardHolder: 'Huésped de Prueba',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  };

  // Llegada del 10 de marzo de 2027: 15:00 en Colombia = 20:00 UTC.
  const CHECK_IN = '2027-03-10';
  const ARRIVAL = Date.parse('2027-03-10T20:00:00Z');
  const HOUR = 3_600_000;
  const at = (instant: number) => jest.spyOn(Date, 'now').mockReturnValue(instant);

  const confirmedBooking = async (who = guest, checkIn = CHECK_IN, checkOut = '2027-03-13') =>
    bookings.createInstant(
      {
        listingId,
        checkIn,
        checkOut,
        guests: 2,
        idempotencyKey: `40000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`,
        card,
      },
      who,
    );
  const cancel = (booking: BookingResponseDto, who = guest, reason = 'Cambio imprevisto de itinerario') =>
    bookings.cancelBooking(booking.id, { reason }, who);

  const rejectionOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as Record<string, unknown>;
    }
    throw new Error('Se esperaba un rechazo 400');
  };

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

    const listing = listings.create(
      { title: 'Cabaña HU-040', city: 'Guatapé', pricePerNight: 300000, maxGuests: 4, images: ['https://img.example/cabana.jpg'] },
      host,
    );
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-03-01', endDate: '2027-03-31' }, host);
    listing.status = ListingStatus.ACTIVA;
    listingId = listing.id;
  });

  afterEach(() => jest.restoreAllMocks());

  it('la llegada es a las 15:00 del día de llegada en hora de Colombia', () => {
    expect(arrivalInstant(CHECK_IN)).toBe(ARRIVAL);
    expect(arrivalInstant('2027-03-10T00:00:00.000Z')).toBe(ARRIVAL);
  });

  describe('CA1 · Cancelar una reserva CONFIRMADA antes de la llegada', () => {
    it('pasa a CANCELADA y el periodo vuelve a estar disponible', async () => {
      const booking = await confirmedBooking();
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(listingsService.unavailableNights(listingId, CHECK_IN, '2027-03-13')).toHaveLength(3);
      at(ARRIVAL - 10 * 24 * HOUR);

      const cancelled = await cancel(booking);

      expect(cancelled.status).toBe(BookingStatus.CANCELADA);
      expect(listingsService.unavailableNights(listingId, CHECK_IN, '2027-03-13')).toEqual([]);
      expect(listingsService.getReservedPeriods(listingId)).toEqual([]);
    });

    it('otro huésped puede reservar y pagar las mismas noches después de la cancelación', async () => {
      const booking = await confirmedBooking();
      at(ARRIVAL - 10 * 24 * HOUR);
      await cancel(booking);

      const again = await confirmedBooking(otherGuest);

      expect(again.status).toBe(BookingStatus.CONFIRMADA);
    });

    it('solo libera las noches de la reserva cancelada', async () => {
      const mine = await confirmedBooking(guest, CHECK_IN, '2027-03-12');
      await confirmedBooking(otherGuest, '2027-03-12', '2027-03-14');
      at(ARRIVAL - 10 * 24 * HOUR);

      const cancelled = await cancel(mine);

      expect(cancelled.cancellation?.releasedNights).toEqual(['2027-03-10', '2027-03-11']);
      expect(listingsService.unavailableNights(listingId, '2027-03-10', '2027-03-14')).toEqual(['2027-03-12', '2027-03-13']);
    });

    it.each([
      ['49 horas antes: 100 %', 49 * HOUR, 100],
      ['justo 48 horas antes: 100 %', 48 * HOUR, 100],
      ['47 horas antes: 50 %', 47 * HOUR, 50],
      ['un minuto antes de la llegada: 50 %', 60_000, 50],
    ])('aplica la política Flexible de la publicación · %s', async (_case, before, percentage) => {
      const booking = await confirmedBooking();
      at(ARRIVAL - before);

      const cancelled = await cancel(booking);

      const refundable = Math.round((booking.totalAmount - (booking.serviceFee ?? 0)) * 100) / 100;
      expect(cancelled.cancellation).toMatchObject({
        policy: 'FLEXIBLE',
        refundPercentage: percentage,
        refundableAmount: refundable,
        refundAmount: Math.round(refundable * percentage) / 100,
      });
    });
  });

  describe('CA2 · Si la fecha de llegada ya pasó, el sistema impide cancelar', () => {
    it.each([
      ['a la hora de llegada', 0],
      ['durante la estancia', 24 * HOUR],
      ['después de la salida', 5 * 24 * HOUR],
    ])('rechaza la cancelación %s y la reserva sigue CONFIRMADA con sus noches bloqueadas', async (_case, after) => {
      const booking = await confirmedBooking();
      at(ARRIVAL + after);

      const rejection = await rejectionOf(cancel(booking));

      expect(rejection).toMatchObject({
        reason: 'LLEGADA_PASADA',
        message: 'La fecha de llegada (2027-03-10) ya pasó; la reserva no se puede cancelar',
      });
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(booking.cancellation).toBeUndefined();
      expect(listingsService.getReservedPeriods(listingId)).toHaveLength(1);
      expect(audit.findAll({ action: AuditAction.BOOKING_CANCELLATION }).at(-1)).toMatchObject({
        entityId: booking.id,
        result: AuditResult.FALLIDO,
        detail: 'Cancelación rechazada: la llegada (2027-03-10) ya pasó',
      });
    });
  });

  describe('CA3 · Registro de la cancelación y evento de auditoría', () => {
    it('guarda usuario, fecha y hora, motivo, valor de devolución y estado final', async () => {
      const booking = await confirmedBooking();
      const now = ARRIVAL - 72 * HOUR;
      at(now);

      const cancelled = await cancel(booking, guest, '  Motivos médicos o de salud  ');

      expect(cancelled.cancellation).toEqual({
        cancelledBy: guest.email,
        cancelledAt: new Date(now).toISOString(),
        reason: 'Motivos médicos o de salud',
        policy: 'FLEXIBLE',
        refundPercentage: 100,
        refundableAmount: booking.totalAmount - (booking.serviceFee ?? 0),
        refundAmount: booking.totalAmount - (booking.serviceFee ?? 0),
        appliedRule: 'Política Flexible: 100 % de devolución (sin la tarifa de servicio) por cancelar al menos 48 h antes de la llegada',
        currency: 'COP',
        finalStatus: BookingStatus.CANCELADA,
        releasedNights: ['2027-03-10', '2027-03-11', '2027-03-12'],
      });
      expect((await bookings.findOne(booking.id)).cancellation).toEqual(cancelled.cancellation);
    });

    it('genera un evento de auditoría con el usuario, el motivo, la devolución y el estado final', async () => {
      const booking = await confirmedBooking();
      at(ARRIVAL - 72 * HOUR);
      const cancelled = await cancel(booking);

      const event = audit.findAll({ action: AuditAction.BOOKING_CANCELLATION }).find((item) => item.entityId === booking.id)!;
      expect(event).toMatchObject({ actor: guest.email, entity: 'Booking', result: AuditResult.EXITOSO });
      expect(event.detail).toContain(`Reserva cancelada por ${guest.email}`);
      expect(event.detail).toContain('Motivo: Cambio imprevisto de itinerario');
      expect(event.detail).toContain(`Devolución simulada ${cancelled.cancellation?.refundAmount} COP`);
      expect(event.detail).toContain('Estado final: CANCELADA');
      expect(audit.findAll({ action: AuditAction.RESERVED_PERIOD_BLOCK }).filter((item) => item.entityId === listingId).at(-1)?.detail).toBe(
        `Periodo liberado por la cancelación de la reserva ${booking.id}: noches 2027-03-10, 2027-03-11, 2027-03-12`,
      );
    });

    it('el registro se conserva al guardar y recuperar las reservas de PostgreSQL', async () => {
      const booking = await confirmedBooking();
      at(ARRIVAL - 72 * HOUR);
      const cancelled = await cancel(booking);

      const restored = rowsToSource('bookings', sourceToRows('bookings', [structuredClone(cancelled)])) as BookingResponseDto[];

      expect(restored[0].status).toBe(BookingStatus.CANCELADA);
      expect(restored[0].cancellation).toEqual(cancelled.cancellation);
    });
  });

  describe('Reglas de quién y qué se puede cancelar', () => {
    it('otro usuario no puede cancelar la reserva', async () => {
      const booking = await confirmedBooking();
      at(ARRIVAL - 72 * HOUR);

      await expect(cancel(booking, otherGuest)).rejects.toThrow(ForbiddenException);
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(audit.findAll({ action: AuditAction.BOOKING_CANCELLATION }).at(-1)).toMatchObject({ result: AuditResult.FALLIDO });
    });

    it('una reserva PENDIENTE (sin pagar) o ya CANCELADA no se cancela', async () => {
      const pending = await bookings.createInstant(
        { listingId, checkIn: '2027-03-20', checkOut: '2027-03-22', guests: 2, idempotencyKey: '40000000-0000-4000-8000-0000000000ff' },
        guest,
      );
      at(ARRIVAL - 72 * HOUR);
      expect((await rejectionOf(cancel(pending))).reason).toBe('ESTADO_NO_CANCELABLE');

      const booking = await confirmedBooking();
      await cancel(booking);
      expect(await rejectionOf(cancel(booking))).toMatchObject({
        reason: 'ESTADO_NO_CANCELABLE',
        message: 'Solo se pueden cancelar reservas confirmadas (estado actual: CANCELADA)',
      });
    });

    it('una reserva sin tarifa de servicio ni noches bloqueadas devuelve sobre el total y no libera noches', async () => {
      const booking = await bookings.createInstant(
        { listingId, checkIn: CHECK_IN, checkOut: '2027-03-12', guests: 2, idempotencyKey: '40000000-0000-4000-8000-0000000000dd' },
        guest,
      );
      booking.status = BookingStatus.CONFIRMADA;
      booking.serviceFee = undefined;
      at(ARRIVAL - 72 * HOUR);

      const cancelled = await bookingsService.cancelBooking(booking.id, {} as CancelBookingDto, guest.email);

      expect(cancelled.cancellation).toMatchObject({ reason: '', refundableAmount: booking.totalAmount, refundAmount: booking.totalAmount, releasedNights: [] });
    });

    it('sin servicio de publicaciones se cancela sin devolución ni noches que liberar', async () => {
      const standalone = new BookingsService(audit);
      const booking = await standalone.createInstant(
        { listingId: 'sin-servicio', checkIn: CHECK_IN, checkOut: '2027-03-12', guests: 2, idempotencyKey: '40000000-0000-4000-8000-0000000000ee' },
        guest.email,
      );
      await standalone.confirmBooking(booking.id);
      at(ARRIVAL - 72 * HOUR);

      const cancelled = await standalone.cancelBooking(booking.id, { reason: 'Viaje aplazado' }, guest.email);

      expect(cancelled.cancellation).toMatchObject({ policy: 'SIN_POLITICA', refundPercentage: 0, refundAmount: 0, releasedNights: [] });
    });
  });

  describe('Validación del motivo (RF-053)', () => {
    it.each([
      ['vacío', ''],
      ['solo espacios', '    '],
      ['muy corto', 'no'],
      ['muy largo', 'x'.repeat(501)],
    ])('rechaza un motivo %s', async (_case, reason) => {
      const errors = await validate(plainToInstance(CancelBookingDto, { reason }));
      expect(errors.length).toBeGreaterThan(0);
    });

    it('acepta un motivo válido y le quita los espacios', async () => {
      const dto = plainToInstance(CancelBookingDto, { reason: '  Viaje aplazado  ' });
      expect(await validate(dto)).toEqual([]);
      expect(dto.reason).toBe('Viaje aplazado');
    });
  });

  describe('Mis reservas (HU-003) para cancelar desde la web', () => {
    it('lista solo las reservas del huésped con los datos de su publicación', async () => {
      await confirmedBooking(guest);
      await confirmedBooking(otherGuest, '2027-03-20', '2027-03-22');

      const mine = await bookings.findMyBookings(guest);

      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        guestId: guest.email,
        listingTitle: 'Cabaña HU-040',
        listingCity: 'Guatapé',
        listingImage: 'https://img.example/cabana.jpg',
        cancellationPolicyName: 'Flexible',
      });
      expect(await bookingsService.findMyBookings()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mock-booking-uuid-1' })]));
    });
  });
});
