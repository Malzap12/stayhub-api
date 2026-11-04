import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { rowsToSource, sourceToRows } from '../persistence/state-tables';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-042 · Cancelar una reserva como anfitrión (CA1, CA2 · RF-057, RN-017, RN-029, AMB-10)', () => {
  let controller: BookingsController;
  let bookingsService: BookingsService;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let notifications: NotificationsService;
  let audit: AuditService;
  let auth: AuthService;
  let listingId: string;
  let keySequence = 0;

  const session = (role: Role, name: string): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role,
    expiresAt: Date.now() + 3_600_000,
  });

  const host = session(Role.ANFITRION, 'anfitrion42');
  const otherHost = session(Role.ANFITRION, 'otro.anfitrion42');
  const guest = session(Role.HUESPED, 'huesped42');
  const secondGuest = session(Role.HUESPED, 'huesped42b');

  const card: PaymentCardDto = {
    cardNumber: '4242424242424242',
    cardHolder: 'Huésped Prueba',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  };

  // Llegada el 15 de marzo de 2027 a las 15:00 hora de Colombia (20:00 UTC).
  const CHECK_IN = '2027-03-15';
  const CHECK_OUT = '2027-03-18';
  const ARRIVAL = Date.parse('2027-03-15T20:00:00Z');
  const HOUR = 3_600_000;
  const at = (instant: number) => jest.spyOn(Date, 'now').mockReturnValue(instant);

  const createConfirmed = async (who = guest, checkIn = CHECK_IN, checkOut = CHECK_OUT) =>
    controller.createInstant(
      {
        listingId,
        checkIn,
        checkOut,
        guests: 2,
        idempotencyKey: `42000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`,
        card,
      },
      who,
    );

  const expectBadRequest = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as Record<string, unknown>;
    }
    throw new Error('Se esperaba un BadRequestException');
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [
        BookingsService,
        ListingsService,
        PlatformConfigService,
        AuditService,
        PaymentsService,
        NotificationsService,
        AuthService,
      ],
    }).compile();

    controller = module.get(BookingsController);
    bookingsService = module.get(BookingsService);
    listings = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    notifications = module.get(NotificationsService);
    audit = module.get(AuditService);
    auth = module.get(AuthService);

    await auth.register({
      name: 'Huésped Cuarenta y Dos',
      email: guest.email,
      password: 'Password123',
      phone: '3009998877',
      role: Role.HUESPED,
    });

    const created = listings.create(
      {
        title: 'Villa del Lago',
        city: 'Guatapé',
        pricePerNight: 250000,
        maxGuests: 4,
        images: ['https://img.example/villa.jpg'],
      },
      host,
    );
    await listings.registerAvailabilityPeriod(created.id, { startDate: '2027-03-01', endDate: '2027-03-31' }, host);
    created.status = ListingStatus.ACTIVA;
    listingId = created.id;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('CA1 · Cancelación con devolución del 100 % del total y liberación del periodo', () => {
    it('pasa a CANCELADA, devuelve el 100 % del total (incluida tarifa de servicio) y libera las noches', async () => {
      const booking = await createConfirmed();
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(booking.serviceFee).toBeGreaterThan(0);
      expect(listingsService.unavailableNights(listingId, CHECK_IN, CHECK_OUT)).toEqual([
        '2027-03-15',
        '2027-03-16',
        '2027-03-17',
      ]);

      // Incluso faltando solo 4 horas para la llegada, el anfitrión devuelve el 100 % del total.
      const cancelTime = ARRIVAL - 4 * HOUR;
      at(cancelTime);

      const cancelled = await controller.cancelHostBooking(
        booking.id,
        { reason: '  Avería eléctrica mayor en el alojamiento  ' },
        host,
      );

      expect(cancelled.status).toBe(BookingStatus.CANCELADA);
      expect(cancelled.guestContact).toBeUndefined();
      expect(cancelled.cancellation).toEqual({
        cancelledAt: new Date(cancelTime).toISOString(),
        reason: 'Avería eléctrica mayor en el alojamiento',
        policy: 'CANCELACION_ANFITRION',
        refundPercentage: 100,
        refundableAmount: booking.totalAmount,
        refundAmount: booking.totalAmount,
        appliedRule: 'Cancelación por el anfitrión: devolución del 100 % del total pagado, incluida la tarifa de servicio',
        currency: 'COP',
        finalStatus: BookingStatus.CANCELADA,
        releasedNights: ['2027-03-15', '2027-03-16', '2027-03-17'],
      });
      expect(JSON.stringify(cancelled)).not.toContain(guest.email);
      expect(listingsService.unavailableNights(listingId, CHECK_IN, CHECK_OUT)).toEqual([]);
      expect(listingsService.getReservedPeriods(listingId)).toEqual([]);
    });

    it('permite que otro huésped reserve el mismo periodo liberado y preserva reservas vecinas', async () => {
      const target = await createConfirmed(guest, '2027-03-15', '2027-03-17');
      await createConfirmed(secondGuest, '2027-03-17', '2027-03-19');
      at(ARRIVAL - 48 * HOUR);

      const cancelled = await controller.cancelHostBooking(target.id, { reason: 'Mantenimiento urgente de tuberías' }, host);

      expect(cancelled.cancellation?.releasedNights).toEqual(['2027-03-15', '2027-03-16']);
      expect(listingsService.unavailableNights(listingId, '2027-03-15', '2027-03-19')).toEqual(['2027-03-17', '2027-03-18']);

      const rebooked = await createConfirmed(secondGuest, '2027-03-15', '2027-03-17');
      expect(rebooked.status).toBe(BookingStatus.CONFIRMADA);
    });

    it('refleja la cancelación tanto en el detalle del anfitrión como en el del huésped y en persistencia', async () => {
      const booking = await createConfirmed();
      at(ARRIVAL - 24 * HOUR);
      await controller.cancelHostBooking(booking.id, { reason: 'Inconveniente estructural en cubierta' }, host);

      const hostDetail = controller.findHostBooking(booking.id, host);
      expect(hostDetail.status).toBe(BookingStatus.CANCELADA);
      expect(hostDetail.cancellation?.refundAmount).toBe(booking.totalAmount);

      const guestDetail = await controller.findOne(booking.id, guest);
      expect(guestDetail.status).toBe(BookingStatus.CANCELADA);
      expect(guestDetail.cancellation).toMatchObject({
        cancelledBy: host.email,
        reason: 'Inconveniente estructural en cubierta',
        refundPercentage: 100,
        refundAmount: booking.totalAmount,
      });

      const restored = rowsToSource('bookings', sourceToRows('bookings', [structuredClone(guestDetail)])) as BookingResponseDto[];
      expect(restored[0].status).toBe(BookingStatus.CANCELADA);
      expect(restored[0].cancellation?.refundAmount).toBe(booking.totalAmount);
    });
  });

  describe('CA2 · Notificación al huésped y registro en la auditoría', () => {
    it('envía notificación al huésped con el motivo y la devolución del 100 % y deja evento en auditoría', async () => {
      const booking = await createConfirmed();
      at(ARRIVAL - 36 * HOUR);

      await controller.cancelHostBooking(booking.id, { reason: 'Cierre temporal por fumigación' }, host);

      const guestNotifs = notifications.findMine({ email: guest.email });
      const cancelNotif = guestNotifs.find((item) => item.type === 'RESERVA_CANCELADA');
      expect(cancelNotif).toBeDefined();
      expect(cancelNotif).toMatchObject({
        recipientEmail: guest.email,
        type: 'RESERVA_CANCELADA',
        entity: 'Booking',
        entityId: booking.id,
        bookingCode: booking.code,
        read: false,
      });
      expect(cancelNotif?.message).toContain('El anfitrión canceló tu reserva');
      expect(cancelNotif?.message).toContain('Villa del Lago');
      expect(cancelNotif?.message).toContain('Cierre temporal por fumigación');
      expect(cancelNotif?.message).toContain(`${booking.totalAmount} COP`);
      expect(cancelNotif?.message).toContain('100 %');

      const event = audit.findAll({ action: AuditAction.BOOKING_CANCELLATION }).find((item) => item.entityId === booking.id);
      expect(event).toBeDefined();
      expect(event).toMatchObject({
        actor: host.email,
        entity: 'Booking',
        result: AuditResult.EXITOSO,
      });
      expect(event?.detail).toContain(`cancelada por el anfitrión (${host.email})`);
      expect(event?.detail).toContain('Motivo: Cierre temporal por fumigación');
      expect(event?.detail).toContain(`Devolución simulada ${booking.totalAmount} COP (100 % del total)`);
      expect(event?.detail).toContain('Estado final: CANCELADA');
      expect(event?.detail).not.toMatch(/\b(HU|RF|RN)-\d/);
    });

    it('soporta notificación sin título de alojamiento y reserva sin noches previamente bloqueadas', async () => {
      notifications.bookingCancelledByHost(
        { id: 'b-sin-titulo', checkIn: '2027-04-01', checkOut: '2027-04-03', guestEmail: guest.email },
        'Obra civil',
        { amount: 500000, percentage: 100, currency: 'COP' },
      );
      expect(notifications.findMine({ email: guest.email })[0].message).toContain('reserva b-sin-titulo del 2027-04-01 al 2027-04-03');

      const manual = await controller.createInstant(
        { listingId, checkIn: '2027-03-22', checkOut: '2027-03-24', guests: 1, idempotencyKey: '42000000-0000-4000-8000-000000000099' },
        guest,
      );
      manual.status = BookingStatus.CONFIRMADA;
      manual.code = undefined;
      at(ARRIVAL - 24 * HOUR);

      const cancelled = await bookingsService.cancelHostBooking(manual.id, { reason: 'Reparación de techo' }, host);
      expect(cancelled.cancellation?.releasedNights).toEqual([]);
    });
  });

  describe('Reglas de autorización y validaciones de estado', () => {
    it('rechaza con 404 si la reserva no existe o pertenece a otro anfitrión y audita el intento fallido', async () => {
      const booking = await createConfirmed();
      at(ARRIVAL - 48 * HOUR);

      await expect(controller.cancelHostBooking('inexistente', { reason: 'Motivo válido' }, host)).rejects.toThrow(NotFoundException);
      await expect(controller.cancelHostBooking(booking.id, { reason: 'Motivo válido' }, otherHost)).rejects.toThrow(NotFoundException);

      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
      const failures = audit.findAll({ action: AuditAction.BOOKING_CANCELLATION, result: AuditResult.FALLIDO });
      expect(failures.length).toBeGreaterThanOrEqual(2);
    });

    it('impide cancelar reservas no confirmadas (PENDIENTE o ya CANCELADA)', async () => {
      const pending = await controller.createInstant(
        { listingId, checkIn: '2027-03-25', checkOut: '2027-03-27', guests: 2, idempotencyKey: '42000000-0000-4000-8000-000000000088' },
        guest,
      );
      at(ARRIVAL - 48 * HOUR);

      expect((await expectBadRequest(controller.cancelHostBooking(pending.id, { reason: 'No disponible' }, host))).reason).toBe(
        'ESTADO_NO_CANCELABLE',
      );

      const confirmed = await createConfirmed();
      await controller.cancelHostBooking(confirmed.id, { reason: 'Daño eléctrico' }, host);
      expect((await expectBadRequest(controller.cancelHostBooking(confirmed.id, { reason: 'Segundo intento' }, host))).reason).toBe(
        'ESTADO_NO_CANCELABLE',
      );
    });

    it('impide cancelar cuando la fecha de llegada ya pasó', async () => {
      const booking = await createConfirmed();
      at(ARRIVAL + HOUR);

      const rejection = await expectBadRequest(controller.cancelHostBooking(booking.id, { reason: 'Imprevisto tardío' }, host));
      expect(rejection.reason).toBe('LLEGADA_PASADA');
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
    });

    it('exige un motivo de al menos 3 caracteres incluso al invocar el servicio directamente', async () => {
      const booking = await createConfirmed();
      at(ARRIVAL - 48 * HOUR);

      const rejection = await expectBadRequest(bookingsService.cancelHostBooking(booking.id, { reason: '  ' } as CancelBookingDto, host));
      expect(rejection.reason).toBe('MOTIVO_REQUERIDO');
      expect(booking.status).toBe(BookingStatus.CONFIRMADA);
    });
  });
});
