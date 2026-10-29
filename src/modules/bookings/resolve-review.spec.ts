import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ResolveReviewDto, ReviewDecision } from './dto/resolve-review.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-052 · Resolver las reservas en revisión (CA1, CA2, RF-071, RN-017, RN-020)', () => {
  let controller: BookingsController;
  let bookings: BookingsService;
  let listings: ListingsService;
  let audit: AuditService;
  let notifications: NotificationsService;
  let store: BookingResponseDto[];

  const listingId = 'demo-bogota-chapinero';
  const reason = 'Las fotografías no corresponden al inmueble';
  const now = new Date('2026-11-05T17:00:00Z');
  const admin: ActiveSession = {
    token: 'jwt-admin',
    userId: 'admin-1',
    email: 'admin@inversioneslr.com',
    role: Role.ADMINISTRADOR,
    expiresAt: Date.now() + 3_600_000,
  };

  const booking = (id: string, status: BookingStatus, checkIn = '2026-12-01', checkOut = '2026-12-04'): BookingResponseDto => ({
    id,
    code: `RES-${id.toUpperCase()}`,
    listingId,
    guestId: `${id}@prueba.com`,
    checkIn,
    checkOut,
    guests: 2,
    totalAmount: 900000,
    serviceFee: 80000,
    currency: 'COP',
    status,
    idempotencyKey: `key-${id}`,
    createdAt: new Date('2026-10-01T12:00:00Z'),
  });

  /** Reserva confirmada con sus noches reservadas, que luego queda EN_REVISION al bloquear la publicación. */
  const underReview = (id: string, status: BookingStatus = BookingStatus.CONFIRMADA): BookingResponseDto => {
    const item = booking(id, status);
    store.push(item);
    if (status === BookingStatus.CONFIRMADA) {
      listings.blockReservedPeriod(listingId, { checkIn: item.checkIn, checkOut: item.checkOut, bookingId: item.id }, 'sistema');
    }
    listings.blockListing(listingId, { reason }, admin.email, now);
    return item;
  };
  const reservedNights = () => listings.getReservedPeriods(listingId).flatMap((period) => period.blockedNights);
  /** Notificaciones posteriores a la revisión (se omite el aviso de «quedó en revisión»). */
  const inbox = (email: string) => notifications.findMine({ email }).filter((item) => item.type !== 'RESERVA_EN_REVISION');
  const hostInbox = () =>
    notifications.findMine({ userId: listings.getListing(listingId)!.hostId }).filter((item) => item.type !== 'PUBLICACION_BLOQUEADA');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [ListingsService, BookingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService, AuthService],
    }).compile();
    module.get(BookingsService).onModuleInit();

    controller = module.get(BookingsController);
    bookings = module.get(BookingsService);
    listings = module.get(ListingsService);
    audit = module.get(AuditService);
    notifications = module.get(NotificationsService);
    store = (bookings as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;
  });

  it('al pasar a revisión se guarda el estado que tenía la reserva', () => {
    const item = underReview('guardada');

    expect(item).toMatchObject({ status: BookingStatus.EN_REVISION, statusBeforeReview: BookingStatus.CONFIRMADA });
  });

  it('lista solo las reservas en revisión, con el alojamiento, de la más antigua a la más reciente', () => {
    const first = underReview('primera');
    first.underReviewAt = new Date('2026-11-01T10:00:00Z');
    store.push({ ...booking('segunda', BookingStatus.EN_REVISION), underReviewAt: new Date('2026-11-02T10:00:00Z') });
    store.push(booking('confirmada', BookingStatus.CONFIRMADA, '2027-01-10', '2027-01-12'));

    const list = controller.findUnderReview();

    expect(list.map((item) => item.id)).toEqual(['primera', 'segunda']);
    expect(list[0]).toMatchObject({ listingTitle: expect.any(String), reviewReason: expect.stringContaining(reason) });
  });

  describe('CA1 · Mantener la reserva', () => {
    it('vuelve a CONFIRMADA, conserva sus noches y registra la decisión', async () => {
      const item = underReview('mantener');
      const nights = reservedNights();

      const result = await controller.resolveReview(item.id, { decision: ReviewDecision.MANTENER, note: 'El alojamiento es el anunciado' }, admin);

      expect(result.status).toBe(BookingStatus.CONFIRMADA);
      expect(result.reviewResolution).toMatchObject({
        decision: ReviewDecision.MANTENER,
        resolvedBy: admin.email,
        finalStatus: BookingStatus.CONFIRMADA,
        note: 'El alojamiento es el anunciado',
      });
      expect(result.cancellation).toBeUndefined();
      expect(reservedNights()).toEqual(nights);
      expect(nights).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    });

    it('notifica al huésped y al anfitrión', async () => {
      const item = underReview('aviso');

      await controller.resolveReview(item.id, { decision: ReviewDecision.MANTENER }, admin);

      expect(inbox(item.guestId)[0]).toMatchObject({ type: 'RESERVA_MANTENIDA', bookingCode: item.code });
      expect(inbox(item.guestId)[0].message).toContain('sigue confirmada');
      expect(hostInbox()[0]).toMatchObject({ type: 'RESERVA_MANTENIDA', bookingCode: item.code });
    });

    it('queda en la auditoría', async () => {
      const item = underReview('auditada');

      await controller.resolveReview(item.id, { decision: ReviewDecision.MANTENER }, admin);

      const [event] = audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE }).filter((e) => e.detail?.includes('decidió mantenerla'));
      expect(event).toMatchObject({ actor: admin.email, entityId: item.id, result: AuditResult.EXITOSO });
      expect(event.detail).toContain('EN_REVISION a CONFIRMADA');
    });

    it('si aún no estaba pagada vuelve a PENDIENTE, para no confirmar sin pago', async () => {
      const item = underReview('sin-pago', BookingStatus.PENDIENTE);

      const result = await bookings.resolveReview(item.id, { decision: ReviewDecision.MANTENER }, admin.email);

      expect(result.status).toBe(BookingStatus.PENDIENTE);
      expect(inbox(item.guestId)[0].message).toContain('sigue pendiente de pago');
    });

    it('una reserva guardada antes de este cambio, sin estado previo, vuelve a CONFIRMADA', async () => {
      store.push(booking('antigua', BookingStatus.EN_REVISION));

      expect((await bookings.resolveReview('antigua', { decision: ReviewDecision.MANTENER }, admin.email)).status).toBe(BookingStatus.CONFIRMADA);
    });
  });

  describe('CA2 · Cancelar la reserva', () => {
    it('pasa a CANCELADA con devolución simulada del 100 % de lo pagado y libera el periodo', async () => {
      const item = underReview('cancelar');
      expect(reservedNights()).toHaveLength(3);

      const result = await controller.resolveReview(item.id, { decision: ReviewDecision.CANCELAR, note: 'Alojamiento engañoso' }, admin);

      expect(result.status).toBe(BookingStatus.CANCELADA);
      expect(result.cancellation).toMatchObject({
        cancelledBy: admin.email,
        reason: 'Alojamiento engañoso',
        refundPercentage: 100,
        refundableAmount: 900000,
        refundAmount: 900000,
        currency: 'COP',
        finalStatus: BookingStatus.CANCELADA,
        releasedNights: ['2026-12-01', '2026-12-02', '2026-12-03'],
      });
      expect(Date.parse(result.cancellation!.cancelledAt)).not.toBeNaN();
      expect(reservedNights()).toEqual([]);
      expect(result.reviewResolution).toMatchObject({ decision: ReviewDecision.CANCELAR, finalStatus: BookingStatus.CANCELADA });
    });

    it('sin nota, registra un motivo por defecto', async () => {
      const item = underReview('sin-nota');

      const result = await bookings.resolveReview(item.id, { decision: ReviewDecision.CANCELAR }, admin.email);

      expect(result.cancellation?.reason).toContain('El administrador canceló la reserva');
    });

    it('notifica al huésped la devolución y al anfitrión que las noches quedaron libres, y lo audita', async () => {
      const item = underReview('notificada');

      await controller.resolveReview(item.id, { decision: ReviewDecision.CANCELAR }, admin);

      expect(inbox(item.guestId)[0]).toMatchObject({ type: 'RESERVA_CANCELADA' });
      expect(inbox(item.guestId)[0].message).toContain('100 %');
      expect(inbox(item.guestId)[0].message).toContain('900000 COP');
      expect(hostInbox()[0].message).toContain('quedaron libres');
      const [event] = audit.findAll({ action: AuditAction.BOOKING_CANCELLATION, result: AuditResult.EXITOSO });
      expect(event).toMatchObject({ actor: admin.email, entityId: item.id });
      expect(event.detail).toContain('Devolución simulada 900000 COP (100 %)');
    });

    it('si aún no estaba pagada, la devolución es de 0', async () => {
      const item = underReview('pendiente', BookingStatus.PENDIENTE);

      const result = await bookings.resolveReview(item.id, { decision: ReviewDecision.CANCELAR }, admin.email);

      expect(result.cancellation).toMatchObject({ refundPercentage: 100, refundAmount: 0, releasedNights: [] });
    });

    it('la reserva resuelta sale de la lista de revisión', async () => {
      const item = underReview('fuera');

      await bookings.resolveReview(item.id, { decision: ReviewDecision.CANCELAR }, admin.email);

      expect(bookings.findUnderReview()).toEqual([]);
    });
  });

  describe('Validaciones', () => {
    it('solo resuelve reservas EN_REVISION y deja el intento fallido en la auditoría', async () => {
      store.push(booking('confirmada', BookingStatus.CONFIRMADA));

      await expect(bookings.resolveReview('confirmada', { decision: ReviewDecision.MANTENER }, admin.email)).rejects.toThrow(BadRequestException);
      expect(store[0].status).toBe(BookingStatus.CONFIRMADA);
      expect(audit.findAll({ result: AuditResult.FALLIDO })[0].detail).toContain('Resolución de revisión rechazada');
    });

    it('no resuelve dos veces la misma reserva', async () => {
      const item = underReview('doble');
      await bookings.resolveReview(item.id, { decision: ReviewDecision.CANCELAR }, admin.email);

      await expect(bookings.resolveReview(item.id, { decision: ReviewDecision.MANTENER }, admin.email)).rejects.toThrow(BadRequestException);
      expect(item.status).toBe(BookingStatus.CANCELADA);
    });

    it('responde 404 si la reserva no existe', async () => {
      await expect(bookings.resolveReview('no-existe', { decision: ReviewDecision.MANTENER }, admin.email)).rejects.toThrow(NotFoundException);
    });

    it('exige una decisión válida y una nota de máximo 500 caracteres', async () => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: ResolveReviewDto });

      await expect(validate({ decision: 'APROBAR' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(validate({ decision: 'CANCELAR', note: 'x'.repeat(501) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(validate({ decision: 'MANTENER', note: '  ok  ' })).resolves.toEqual({ decision: 'MANTENER', note: 'ok' });
    });
  });
});
