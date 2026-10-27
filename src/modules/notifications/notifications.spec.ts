import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingsController } from '../bookings/bookings.controller';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { rowsToSource, sourceToRows } from '../persistence/state-tables';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { NotificationDto } from './dto/notification.dto';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';

describe('HU-043 · Recibir notificaciones de los eventos (CA1, CA2, CA3, RF-059, RN-021)', () => {
  let bookings: BookingsController;
  let listings: ListingsController;
  let listingsService: ListingsService;
  let authService: AuthService;
  let notifications: NotificationsService;
  let controller: NotificationsController;

  const session = (role: Role, name: string): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role,
    expiresAt: Date.now() + 3_600_000,
  });
  const host = session(Role.ANFITRION, 'anfitrion43');
  const guest = session(Role.HUESPED, 'huesped43');
  const other = session(Role.HUESPED, 'otro43');
  const admin = session(Role.ADMINISTRADOR, 'admin43');
  const mine = (user: ActiveSession) => controller.findMine(user).data;
  const card = { cardNumber: '4242424242424242', cardHolder: 'Huésped', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' };

  const activeListing = async () => {
    const listing = listings.create({ title: 'Cabaña HU-043', city: 'Guatapé', pricePerNight: 250000, maxGuests: 4 }, host);
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-05-01', endDate: '2027-05-31' }, host);
    listing.status = ListingStatus.ACTIVA;
    return listing;
  };
  const confirmedBooking = async (listingId: string): Promise<BookingResponseDto> =>
    bookings.createInstant(
      { listingId, checkIn: '2027-05-10', checkOut: '2027-05-13', guests: 2, idempotencyKey: '43000000-0000-4000-8000-000000000001', card },
      guest,
    );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController, NotificationsController],
      providers: [
        BookingsService,
        ListingsService,
        PlatformConfigService,
        AuditService,
        PaymentsService,
        AuthService,
        NotificationsService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    bookings = module.get(BookingsController);
    listings = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    authService = module.get(AuthService);
    notifications = module.get(NotificationsService);
    controller = module.get(NotificationsController);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('CA1 · Al confirmarse una reserva, el huésped y el anfitrión reciben una notificación con el código', () => {
    it('notifica a ambos con el código de la reserva', async () => {
      const listing = await activeListing();
      const booking = await confirmedBooking(listing.id);

      const [toGuest] = mine(guest);
      const [toHost] = mine(host);
      expect(toGuest).toMatchObject({
        type: 'RESERVA_CONFIRMADA',
        recipientEmail: guest.email,
        entity: 'Booking',
        entityId: booking.id,
        bookingCode: booking.code,
        message: `Tu reserva ${booking.code} en "Cabaña HU-043" del 2027-05-10 al 2027-05-13 está confirmada.`,
        read: false,
      });
      expect(toHost).toMatchObject({
        type: 'RESERVA_CONFIRMADA',
        recipientId: host.userId,
        bookingCode: booking.code,
        message: `Tienes una nueva reserva confirmada ${booking.code} en "Cabaña HU-043" del 2027-05-10 al 2027-05-13.`,
      });
      expect(booking.code).toMatch(/^RES-/);
    });

    it('una reserva sin pagar todavía no genera notificación', async () => {
      const listing = await activeListing();
      await bookings.createInstant(
        { listingId: listing.id, checkIn: '2027-05-10', checkOut: '2027-05-13', guests: 2, idempotencyKey: '43000000-0000-4000-8000-000000000002' },
        guest,
      );
      expect(mine(guest)).toEqual([]);
    });
  });

  describe('CA2 · El usuario afectado recibe la notificación de cada evento', () => {
    it('cancelación: huésped y anfitrión', async () => {
      const listing = await activeListing();
      const booking = await confirmedBooking(listing.id);
      jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-05-01T12:00:00Z'));
      await bookings.cancelBooking(booking.id, { reason: 'Viaje aplazado' }, guest);

      expect(mine(guest)[0]).toMatchObject({ type: 'RESERVA_CANCELADA', bookingCode: booking.code, entityId: booking.id });
      expect(mine(guest)[0].message).toContain('Devolución simulada');
      expect(mine(host)[0]).toMatchObject({ type: 'RESERVA_CANCELADA', bookingCode: booking.code });
      expect(mine(host)[0].message).toContain('vuelven a estar disponibles');
    });

    it('publicación aprobada y devuelta: su anfitrión', async () => {
      const approved = listings.create({ title: 'Para aprobar', city: 'Cali' }, host);
      approved.status = ListingStatus.PENDIENTE_REVISION;
      await listingsService.approveListing(approved.id, admin.email);
      const returned = listings.create({ title: 'Para devolver', city: 'Cali' }, host);
      returned.status = ListingStatus.PENDIENTE_REVISION;
      await listingsService.returnListing(returned.id, { reason: 'Faltan fotos del baño' }, admin.email);

      expect(mine(host).map((n) => [n.type, n.entityId, n.message])).toEqual(
        expect.arrayContaining([
          ['PUBLICACION_APROBADA', approved.id, 'Tu publicación "Para aprobar" fue aprobada y ya está ACTIVA en las búsquedas.'],
          ['PUBLICACION_DEVUELTA', returned.id, 'Tu publicación "Para devolver" fue devuelta a BORRADOR. Motivo: Faltan fotos del baño'],
        ]),
      );
    });

    it('restricción de cuenta: el usuario restringido', async () => {
      await authService.register({ name: 'Huésped', email: guest.email, password: 'Password123', role: Role.HUESPED });
      const account = authService.findByEmail(guest.email)!;

      authService.restrictAccount(guest.email, 'Incumplimiento de políticas', admin.email);

      expect(mine({ ...guest, userId: account.id })[0]).toMatchObject({
        type: 'CUENTA_RESTRINGIDA',
        entity: 'UserAccount',
        entityId: account.id,
        message: 'Tu cuenta fue restringida. Motivo: Incumplimiento de políticas',
      });
    });

    it('bloqueo de publicación y reserva en revisión: anfitrión y huésped', () => {
      notifications.listingModerated({ id: 'listing-1', title: 'Villa', hostId: host.userId }, 'PUBLICACION_BLOQUEADA', 'Contenido engañoso');
      notifications.bookingUnderReview(
        { id: 'booking-1', code: 'RES-0000AAAA', checkIn: '2027-05-10', checkOut: '2027-05-13', guestEmail: guest.email },
        'la publicación fue bloqueada',
      );

      expect(mine(host)[0]).toMatchObject({ type: 'PUBLICACION_BLOQUEADA', message: 'Tu publicación "Villa" fue bloqueada. Motivo: Contenido engañoso' });
      expect(mine(guest)[0]).toMatchObject({
        type: 'RESERVA_EN_REVISION',
        bookingCode: 'RES-0000AAAA',
        message: 'Tu reserva RES-0000AAAA quedó en revisión: la publicación fue bloqueada. Te avisaremos cuando se resuelva.',
      });
    });

    it('un usuario solo ve sus notificaciones', async () => {
      const listing = await activeListing();
      await confirmedBooking(listing.id);
      expect(mine(other)).toEqual([]);
    });
  });

  describe('CA3 · Cada notificación guarda destinatario, tipo, mensaje, entidad, fecha y estado de lectura', () => {
    it('incluye todos los campos y empieza sin leer', () => {
      const created = notifications.notify({
        recipient: { email: ' Huesped43@StayHub.com ' },
        type: 'RESERVA_CONFIRMADA',
        message: 'Mensaje',
        entity: 'Booking',
        entityId: 'booking-9',
        bookingCode: 'RES-9',
      })!;

      expect(created).toEqual({
        id: expect.stringMatching(/^notif-/),
        recipientEmail: guest.email,
        type: 'RESERVA_CONFIRMADA',
        message: 'Mensaje',
        entity: 'Booking',
        entityId: 'booking-9',
        bookingCode: 'RES-9',
        createdAt: expect.any(Date),
        read: false,
      });
    });

    it('sin destinatario no guarda nada', () => {
      expect(notifications.notify({ recipient: {}, type: 'RESERVA_CONFIRMADA', message: 'x', entity: 'Booking', entityId: 'b' })).toBeUndefined();
    });

    it('marca como leída una propia, todas a la vez, y no deja tocar las de otro', () => {
      const first = notifications.notify({ recipient: { userId: host.userId }, type: 'PUBLICACION_APROBADA', message: 'a', entity: 'Listing', entityId: 'l1' })!;
      notifications.notify({ recipient: { userId: host.userId }, type: 'PUBLICACION_APROBADA', message: 'b', entity: 'Listing', entityId: 'l2' });
      expect(controller.findMine(host).unread).toBe(2);

      const read = controller.markAsRead(first.id, host);
      expect(read).toMatchObject({ read: true, readAt: expect.any(Date) });
      expect(controller.markAsRead(first.id, host).readAt).toBe(read.readAt);
      expect(controller.findMine(host, 'true').data.map((n) => n.message)).toEqual(['b']);
      expect(() => controller.markAsRead(first.id, other)).toThrow(NotFoundException);

      expect(controller.markAllAsRead(host)).toEqual({ updated: 1 });
      expect(controller.findMine(host).unread).toBe(0);
    });

    it('se ordenan de la más reciente a la más antigua', () => {
      jest.useFakeTimers({ now: new Date('2027-01-01T00:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      notifications.notify({ recipient: { userId: host.userId }, type: 'PUBLICACION_APROBADA', message: 'vieja', entity: 'Listing', entityId: 'l1' });
      jest.setSystemTime(new Date('2027-01-02T00:00:00Z'));
      notifications.notify({ recipient: { userId: host.userId }, type: 'PUBLICACION_DEVUELTA', message: 'nueva', entity: 'Listing', entityId: 'l1' });
      jest.useRealTimers();

      expect(mine(host).map((n) => n.message)).toEqual(['nueva', 'vieja']);
    });

    it('se conservan al guardar y recuperar de PostgreSQL, incluido el estado de lectura', () => {
      const unread = notifications.notify({ recipient: { userId: host.userId }, type: 'PUBLICACION_APROBADA', message: 'a', entity: 'Listing', entityId: 'l1' })!;
      const read = notifications.notify({
        recipient: { email: guest.email },
        type: 'RESERVA_CONFIRMADA',
        message: 'b',
        entity: 'Booking',
        entityId: 'b1',
        bookingCode: 'RES-1',
      })!;
      notifications.markAsRead(read.id, { email: guest.email });

      const rows = sourceToRows('notifications', [unread, read]);
      expect(rows.notificaciones[1]).toMatchObject({ destinatario_correo: guest.email, tipo: 'RESERVA_CONFIRMADA', leida: true, extra: { bookingCode: 'RES-1' } });
      const restored = rowsToSource('notifications', rows) as NotificationDto[];
      expect(restored).toEqual([
        { ...unread, createdAt: new Date(unread.createdAt) },
        { ...read, createdAt: new Date(read.createdAt), readAt: new Date(read.readAt!) },
      ]);
      expect(rowsToSource('notifications', {})).toEqual([]);
      expect(sourceToRows('notifications', undefined).notificaciones).toEqual([]);
    });

    it('arma los mensajes aunque falten el título de la publicación o el código de la reserva', () => {
      const notice = { id: 'booking-7', checkIn: '2027-05-10', checkOut: '2027-05-12', guestEmail: guest.email, hostId: host.userId };
      notifications.bookingConfirmed({ ...notice, code: 'RES-7' });
      notifications.bookingCancelled(notice, { amount: 0, percentage: 0, currency: 'COP' });
      notifications.bookingUnderReview(notice, 'revisión manual');

      expect(mine(guest).map((n) => n.message)).toEqual(
        expect.arrayContaining([
          'Tu reserva RES-7 del 2027-05-10 al 2027-05-12 está confirmada.',
          'Cancelaste la reserva booking-7 del 2027-05-10 al 2027-05-12. Devolución simulada: 0 COP (0 %).',
          'Tu reserva booking-7 quedó en revisión: revisión manual. Te avisaremos cuando se resuelva.',
        ]),
      );
      expect(mine(host).map((n) => n.message)).toContain('El huésped canceló la reserva booking-7 del 2027-05-10 al 2027-05-12; esas noches vuelven a estar disponibles.');
      expect(mine(guest).find((n) => n.type === 'RESERVA_CANCELADA')).not.toHaveProperty('bookingCode');
    });

    it('recupera filas con datos incompletos', () => {
      const [restored] = rowsToSource('notifications', {
        notificaciones: [{ id: 'n1', tipo: 'PUBLICACION_APROBADA', mensaje: 'a', entidad: 'Listing', entidad_id: 'l1', creado_en: '2027-01-01T00:00:00Z', leida: false }],
      }) as NotificationDto[];
      expect(restored).toEqual({ id: 'n1', type: 'PUBLICACION_APROBADA', message: 'a', entity: 'Listing', entityId: 'l1', createdAt: new Date('2027-01-01T00:00:00Z'), read: false });

      const [row] = sourceToRows('notifications', [{ id: 'n2', type: 'RESERVA_CONFIRMADA', message: 'b', entity: 'Booking', entityId: 'b1' }]).notificaciones;
      expect(row).toMatchObject({ destinatario_id: null, destinatario_correo: null, leida: false, leida_en: null, creado_en: expect.any(String) });
    });

    it('el servicio registra y restaura su estado en la persistencia', () => {
      let source: { dump: () => unknown; restore: (data: unknown) => void } | undefined;
      const service = new NotificationsService({ register: (_name: string, registered: typeof source) => (source = registered) } as never);
      service.onModuleInit();
      service.notify({ recipient: { userId: 'u1' }, type: 'PUBLICACION_APROBADA', message: 'a', entity: 'Listing', entityId: 'l1' });
      const saved = structuredClone(source!.dump());

      source!.restore(undefined);
      expect(service.findMine({ userId: 'u1' })).toEqual([]);
      source!.restore(saved);
      expect(service.findMine({ userId: 'u1' })).toHaveLength(1);
    });
  });
});
