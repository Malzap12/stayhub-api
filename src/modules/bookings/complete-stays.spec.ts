import { Test, TestingModule } from '@nestjs/testing';
import { BookingsController } from './bookings.controller';
import { BookingsService, bogotaDate, msUntilNextClosure, SYSTEM_CLOCK_ACTOR } from './bookings.service';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction } from '../../common/enums/audit.enum';
import { BookingResponseDto } from './dto/booking-response.dto';

describe('HU-046 · Completar estancias automáticamente (CA1, CA2, CA3, RF-062)', () => {
  let controller: BookingsController;
  let service: BookingsService;
  let audit: AuditService;
  let notifications: NotificationsService;
  let store: BookingResponseDto[];

  // 28 de octubre de 2026 a las 00:05 en Colombia.
  const closureTime = new Date('2026-10-28T05:05:00Z');
  const guestEmail = 'huesped46@stayhub.com';
  const admin: ActiveSession = {
    token: 'jwt-admin46',
    userId: 'user-admin46',
    email: 'admin46@stayhub.com',
    role: Role.ADMINISTRADOR,
    expiresAt: Date.now() + 3_600_000,
  };

  const booking = (id: string, status: BookingStatus, checkOut: string): BookingResponseDto => ({
    id,
    code: `RES-${id.toUpperCase()}`,
    listingId: 'listing-46',
    guestId: guestEmail,
    checkIn: '2026-10-20',
    checkOut,
    guests: 2,
    totalAmount: 900000,
    serviceFee: 80000,
    currency: 'COP',
    status,
    idempotencyKey: `key-${id}`,
    createdAt: new Date('2026-10-01T12:00:00Z'),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService],
    }).compile();

    controller = module.get(BookingsController);
    service = module.get(BookingsService);
    audit = module.get(AuditService);
    notifications = module.get(NotificationsService);
    store = (service as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;
  });

  it('CA1: una reserva CONFIRMADA con salida en el pasado pasa a COMPLETADA y queda en la auditoría', () => {
    store.push(booking('a1', BookingStatus.CONFIRMADA, '2026-10-27'));

    const result = service.completeFinishedStays(closureTime);

    expect(result).toEqual({ date: '2026-10-28', completed: 1, bookingIds: ['a1'] });
    expect(store[0].status).toBe(BookingStatus.COMPLETADA);
    expect(store[0].completedAt).toEqual(closureTime);
    const events = audit
      .findAll({ action: AuditAction.BOOKING_STATUS_CHANGE })
      .filter((event) => event.entityId === 'a1');
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe(SYSTEM_CLOCK_ACTOR);
    expect(events[0].detail).toContain('CONFIRMADA a COMPLETADA');
  });

  it('CA1: no completa una reserva cuya salida es hoy o en el futuro', () => {
    store.push(booking('hoy', BookingStatus.CONFIRMADA, '2026-10-28'), booking('futura', BookingStatus.CONFIRMADA, '2026-11-02'));

    const result = service.completeFinishedStays(closureTime);

    expect(result.completed).toBe(0);
    expect(store.map((item) => item.status)).toEqual([BookingStatus.CONFIRMADA, BookingStatus.CONFIRMADA]);
  });

  it('CA1: usa la fecha de Colombia y no la UTC para decidir si la salida ya pasó', () => {
    store.push(booking('borde', BookingStatus.CONFIRMADA, '2026-10-27'));

    // 27 de octubre a las 23:30 en Colombia (ya es 28 en UTC): la salida es hoy, aún no se completa.
    expect(service.completeFinishedStays(new Date('2026-10-28T04:30:00Z')).completed).toBe(0);
    expect(store[0].status).toBe(BookingStatus.CONFIRMADA);
  });

  it('CA2: las reservas CANCELADAS, EN_REVISION, PENDIENTES o ya COMPLETADAS no cambian de estado', () => {
    store.push(
      booking('cancelada', BookingStatus.CANCELADA, '2026-10-25'),
      booking('revision', BookingStatus.EN_REVISION, '2026-10-25'),
      booking('pendiente', BookingStatus.PENDIENTE, '2026-10-25'),
      booking('completada', BookingStatus.COMPLETADA, '2026-10-25'),
    );

    const result = service.completeFinishedStays(closureTime);

    expect(result.completed).toBe(0);
    expect(store.map((item) => item.status)).toEqual([
      BookingStatus.CANCELADA,
      BookingStatus.EN_REVISION,
      BookingStatus.PENDIENTE,
      BookingStatus.COMPLETADA,
    ]);
    expect(audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE })).toHaveLength(0);
    expect(notifications.findMine({ email: guestEmail })).toHaveLength(0);
  });

  it('CA2: ejecutarlo dos veces el mismo día no repite el cambio, la auditoría ni la notificación', () => {
    store.push(booking('a1', BookingStatus.CONFIRMADA, '2026-10-26'));

    service.completeFinishedStays(closureTime);
    const second = service.completeFinishedStays(closureTime);

    expect(second.completed).toBe(0);
    expect(audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE })).toHaveLength(1);
    expect(notifications.findMine({ email: guestEmail })).toHaveLength(1);
  });

  it('CA3: el huésped recibe una notificación que lo invita a reseñar', () => {
    store.push(booking('a1', BookingStatus.CONFIRMADA, '2026-10-27'));

    service.completeFinishedStays(closureTime);

    const [notice] = notifications.findMine({ email: guestEmail });
    expect(notice.type).toBe('RESERVA_COMPLETADA');
    expect(notice.entity).toBe('Booking');
    expect(notice.entityId).toBe('a1');
    expect(notice.bookingCode).toBe('RES-A1');
    expect(notice.message).toContain('reseña');
    expect(notice.read).toBe(false);
  });

  it('el administrador puede ejecutar el cierre sin esperar y queda como actor en la auditoría', () => {
    store.push(booking('a1', BookingStatus.CONFIRMADA, '2020-01-05'));

    const result = controller.runDailyClosure(admin);

    expect(result.bookingIds).toEqual(['a1']);
    const [event] = audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE });
    expect(event.actor).toBe(admin.email);
  });

  it('programa el siguiente cierre a las 00:05 de Colombia', () => {
    expect(bogotaDate(new Date('2026-10-28T04:59:00Z'))).toBe('2026-10-27');
    expect(msUntilNextClosure(new Date('2026-10-28T05:00:00Z'))).toBe(5 * 60 * 1000);
    expect(msUntilNextClosure(new Date('2026-10-28T05:05:00Z'))).toBe(24 * 60 * 60 * 1000);
    expect(msUntilNextClosure(new Date('2026-10-28T17:05:00Z'))).toBe(12 * 60 * 60 * 1000);
  });

  it('fuera de las pruebas corre un minuto después de arrancar y luego todos los días a las 00:05', () => {
    jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const run = jest.spyOn(service, 'completeFinishedStays');
    try {
      service.onApplicationBootstrap();
      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(1);

      // Siguiente 00:05 de Colombia: 29 de octubre a las 05:05 UTC.
      jest.advanceTimersByTime(msUntilNextClosure(new Date('2026-10-28T12:01:00Z')) - 1);
      expect(run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(2);
      expect(new Date().toISOString()).toBe('2026-10-29T05:05:00.000Z');
    } finally {
      service.onModuleDestroy();
      process.env.NODE_ENV = previous;
      jest.useRealTimers();
    }
  });

  it('un error en el cierre no detiene la programación del siguiente', () => {
    jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const run = jest.spyOn(service, 'completeFinishedStays').mockImplementation(() => {
      throw new Error('fallo');
    });
    try {
      service.onApplicationBootstrap();
      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);
    } finally {
      service.onModuleDestroy();
      process.env.NODE_ENV = previous;
      jest.useRealTimers();
    }
  });

  it('no programa el cierre automático en las pruebas', () => {
    const timeout = jest.spyOn(global, 'setTimeout');
    service.onApplicationBootstrap();
    expect(timeout).not.toHaveBeenCalled();
    timeout.mockRestore();
    service.onModuleDestroy();
  });
});
