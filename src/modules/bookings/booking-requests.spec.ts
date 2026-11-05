import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { AuditResult } from '../../common/enums/audit.enum';
import { BookingMode } from '../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';

describe('HU-036 · Aprobar o rechazar solicitudes de reserva (CA1, CA2, RF-050, RN-012, RN-015)', () => {
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
  const host = session('anfitrion36', Role.ANFITRION);
  const otherHost = session('otro36', Role.ANFITRION);
  const guest = session('huesped36', Role.HUESPED);

  const card = (cardNumber: string) => ({
    cardNumber,
    cardHolder: 'Huésped HU-036',
    expMonth: 12,
    expYear: new Date().getFullYear() + 2,
    cvc: '123',
  });
  const approvedCard = card('4242424242424242');
  const declinedCard = card('4000000000000002');

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

  const approvalListing = async () => {
    const listing = listings.create(
      { title: 'Finca con aprobación HU-036', city: 'Salento', pricePerNight: 200000, maxGuests: 4, bookingMode: BookingMode.CON_APROBACION },
      host,
    );
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-07-01', endDate: '2027-07-31' }, host);
    listing.status = ListingStatus.ACTIVA;
    return listing;
  };

  const noticeOf = (type: string) => notifications.findMine({ email: guest.email }).find((item) => item.type === type);

  const request = (listingId: string, key: string, paymentCard = approvedCard, checkIn = '2027-07-10', checkOut = '2027-07-13') =>
    bookings.createInstant({ listingId, checkIn, checkOut, guests: 2, idempotencyKey: key, card: paymentCard }, guest);

  describe('Solicitud', () => {
    it('guarda la tarjeta sin cobrarla y sin el número completo ni el CVC', async () => {
      const listing = await approvalListing();

      const pending = await request(listing.id, 'hu036-guardar');

      expect(pending.status).toBe(BookingStatus.PENDIENTE_APROBACION);
      expect(pending.payment).toBeUndefined();
      expect(pending.savedPaymentMethod).toEqual({
        reference: 'pm_test_visa_4242',
        cardBrand: 'VISA',
        cardLast4: '4242',
        cardHolder: 'Huésped HU-036',
        expMonth: 12,
        expYear: approvedCard.expYear,
      });
      expect(JSON.stringify(pending)).not.toContain('4242424242424242');
      expect(bookings.findHostBooking(pending.id, host).paymentCard).toBe('VISA ···· 4242');
    });

    it('sin tarjeta de prueba no se envía la solicitud', async () => {
      const listing = await approvalListing();

      await expect(
        bookings.createInstant({ listingId: listing.id, checkIn: '2027-07-10', checkOut: '2027-07-13', guests: 2, idempotencyKey: 'hu036-sin-tarjeta' }, guest),
      ).rejects.toMatchObject({ response: expect.objectContaining({ reason: 'TARJETA_REQUERIDA' }) });
      await expect(request(listing.id, 'hu036-tarjeta-real', card('4111111111111111'))).rejects.toThrow(BadRequestException);
      expect(bookings.findHostBookings(host)).toEqual([]);
    });
  });

  describe('CA1 · aceptar', () => {
    it('verifica la disponibilidad, cobra el pago simulado y la reserva queda CONFIRMADA con sus noches bloqueadas', async () => {
      const listing = await approvalListing();
      const pending = await request(listing.id, 'hu036-aceptar');

      const result = await bookings.acceptRequest(pending.id, host);

      expect(result.payment).toEqual(expect.objectContaining({ status: PaymentStatus.APROBADO, amount: pending.totalAmount, cardLast4: '4242' }));
      expect(result.booking.status).toBe(BookingStatus.CONFIRMADA);
      expect(result.booking.hostDecision).toEqual(expect.objectContaining({ decision: 'ACEPTADA', decidedBy: host.email }));
      expect(result.booking.savedPaymentMethod).toBeUndefined();
      expect(listingsService.getReservedPeriods(listing.id)).toEqual([expect.objectContaining({ bookingId: pending.id })]);
      expect(noticeOf('RESERVA_CONFIRMADA')).toEqual(expect.objectContaining({ entityId: pending.id }));
      expect(audit.findAll({ result: AuditResult.EXITOSO }).map((event) => event.detail)).toContainEqual(
        expect.stringContaining('aceptada por el anfitrión: disponibilidad verificada'),
      );
    });

    it('si las fechas ya no están disponibles no cobra y la solicitud sigue pendiente', async () => {
      const listing = await approvalListing();
      const first = await request(listing.id, 'hu036-primera');
      const overlapping = await request(listing.id, 'hu036-superpuesta', approvedCard, '2027-07-12', '2027-07-15');
      await bookings.acceptRequest(first.id, host);

      await expect(bookings.acceptRequest(overlapping.id, host)).rejects.toMatchObject({
        response: expect.objectContaining({ reason: 'PERIODO_NO_DISPONIBLE', unavailableNights: ['2027-07-12'] }),
      });

      const after = await bookings.findOne(overlapping.id);
      expect(after.status).toBe(BookingStatus.PENDIENTE_APROBACION);
      expect(after.payment).toBeUndefined();
    });

    it('si el pago se rechaza la solicitud sigue pendiente, no bloquea fechas y avisa al huésped', async () => {
      const listing = await approvalListing();
      const pending = await request(listing.id, 'hu036-rechazo-pago', declinedCard);

      const result = await bookings.acceptRequest(pending.id, host);

      expect(result.payment.status).toBe(PaymentStatus.RECHAZADO);
      expect(result.booking.status).toBe(BookingStatus.PENDIENTE_APROBACION);
      expect(listingsService.getReservedPeriods(listing.id)).toHaveLength(0);
      expect(noticeOf('PAGO_RECHAZADO')).toEqual(expect.objectContaining({ entityId: pending.id }));
    });

    it('una solicitud ya decidida no se acepta de nuevo ni se cobra dos veces', async () => {
      const listing = await approvalListing();
      const pending = await request(listing.id, 'hu036-doble');
      const first = await bookings.acceptRequest(pending.id, host);

      await expect(bookings.acceptRequest(pending.id, host)).rejects.toThrow(ConflictException);
      expect((await bookings.findOne(pending.id)).payment?.reference).toBe(first.payment.reference);
    });
  });

  describe('CA2 · rechazar', () => {
    it('queda RECHAZADA con el motivo, no se cobra y se notifica al huésped', async () => {
      const listing = await approvalListing();
      const pending = await request(listing.id, 'hu036-rechazar');

      const rejected = await bookings.rejectRequest(pending.id, { reason: '  Esas fechas ya las tengo comprometidas.  ' }, host);

      expect(rejected.status).toBe(BookingStatus.RECHAZADA);
      expect(rejected.payment).toBeUndefined();
      expect(rejected.savedPaymentMethod).toBeUndefined();
      expect(rejected.hostDecision).toEqual(
        expect.objectContaining({ decision: 'RECHAZADA', decidedBy: host.email, reason: 'Esas fechas ya las tengo comprometidas.' }),
      );
      expect(listingsService.getReservedPeriods(listing.id)).toHaveLength(0);
      expect(noticeOf('SOLICITUD_RECHAZADA')).toEqual(expect.objectContaining({ entityId: pending.id }));
      expect(noticeOf('SOLICITUD_RECHAZADA')?.message).toContain('No se te cobró nada. Motivo: Esas fechas ya las tengo comprometidas.');
      expect(bookings.findHostBooking(pending.id, host).rejectionReason).toBe('Esas fechas ya las tengo comprometidas.');
    });

    it('el motivo es opcional', async () => {
      const listing = await approvalListing();
      const pending = await request(listing.id, 'hu036-sin-motivo');

      const rejected = await bookings.rejectRequest(pending.id, {}, host);

      expect(rejected.status).toBe(BookingStatus.RECHAZADA);
      expect(rejected.hostDecision?.reason).toBeUndefined();
      expect(noticeOf('SOLICITUD_RECHAZADA')?.message).not.toContain('Motivo');
    });

    it('una solicitud rechazada no se puede aceptar ni pagar', async () => {
      const listing = await approvalListing();
      const pending = await request(listing.id, 'hu036-rechazada');
      await bookings.rejectRequest(pending.id, {}, host);

      await expect(bookings.acceptRequest(pending.id, host)).rejects.toMatchObject({
        response: expect.objectContaining({ reason: 'SOLICITUD_NO_PENDIENTE', currentStatus: BookingStatus.RECHAZADA }),
      });
      await expect(bookings.payBooking(pending.id, approvedCard, guest)).rejects.toThrow(BadRequestException);
    });
  });

  it('solo el anfitrión del alojamiento decide; las demás respuestas son 404', async () => {
    const listing = await approvalListing();
    const pending = await request(listing.id, 'hu036-otro');

    await expect(bookings.acceptRequest(pending.id, otherHost)).rejects.toThrow(NotFoundException);
    await expect(bookings.rejectRequest(pending.id, {}, otherHost)).rejects.toThrow(NotFoundException);
    await expect(bookings.acceptRequest('booking-inexistente', host)).rejects.toThrow(NotFoundException);
    expect((await bookings.findOne(pending.id)).status).toBe(BookingStatus.PENDIENTE_APROBACION);
  });

  it('una reserva inmediata no pasa por la decisión del anfitrión', async () => {
    const listing = await approvalListing();
    listings.updateBookingMode(listing.id, { mode: BookingMode.INMEDIATA }, host);
    const booking = await request(listing.id, 'hu036-inmediata');

    expect(booking.status).toBe(BookingStatus.CONFIRMADA);
    await expect(bookings.rejectRequest(booking.id, {}, host)).rejects.toThrow(ConflictException);
  });
});
