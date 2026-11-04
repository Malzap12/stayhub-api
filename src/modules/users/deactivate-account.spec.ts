import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { CreateListingDto } from '../listings/dto/create-listing.dto';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-008 · Desactivar mi cuenta (CA1, CA2, CA3, RF-011, RN-021)', () => {
  let users: UsersService;
  let auth: AuthService;
  let audit: AuditService;
  let listings: ListingsService;
  let store: BookingResponseDto[];

  const now = new Date('2026-11-05T17:00:00Z');

  const registerAndLogin = async (email: string, role: Role.HUESPED | Role.ANFITRION) => {
    await auth.register({ name: 'Usuario Prueba', email, password: 'Password123', role });
    const { token } = await auth.login({ email, password: 'Password123' });
    return auth.getSession(token) as ActiveSession;
  };

  const listing = (host: ActiveSession, title: string, status: ListingStatus) => {
    const created = listings.create(
      {
        title,
        description: 'Alojamiento de prueba',
        city: 'Jardín',
        department: 'Antioquia',
        address: 'Calle 1',
        propertyType: 'CASA',
        maxGuests: 4,
        pricePerNight: 200000,
        amenities: ['WIFI'],
        rules: ['No fumar'],
        images: ['https://images.unsplash.com/photo-1'],
      } as unknown as CreateListingDto,
      host,
    );
    listings.getListing(created.id)!.status = status;
    return created.id;
  };

  const booking = (id: string, listingId: string, guestId: string, status: BookingStatus, checkIn: string, checkOut: string) =>
    store.push({
      id,
      code: `RES-${id.toUpperCase()}`,
      listingId,
      guestId,
      checkIn,
      checkOut,
      guests: 2,
      totalAmount: 600000,
      currency: 'COP',
      status,
      idempotencyKey: `key-${id}`,
      createdAt: new Date('2026-10-01T12:00:00Z'),
    });

  const lastDeactivation = () => audit.findAll({ action: AuditAction.ACCOUNT_DEACTIVATION }).at(-1);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, AuthService, AuditService, ListingsService, BookingsService, PlatformConfigService, PaymentsService, NotificationsService],
    }).compile();

    users = module.get(UsersService);
    auth = module.get(AuthService);
    audit = module.get(AuditService);
    listings = module.get(ListingsService);
    store = (module.get(BookingsService) as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;
  });

  describe('CA1 · Sin reservas futuras confirmadas', () => {
    it('la cuenta pasa a DESACTIVADA, la sesión se cierra y se registra el evento', async () => {
      const guest = await registerAndLogin('huesped.008@prueba.com', Role.HUESPED);

      const result = users.deactivateMyAccount(guest, now);

      expect(result).toMatchObject({ status: 'DESACTIVADA', pausedListings: [] });
      expect(result.message).toContain('Tu historial se conserva');
      const account = auth.findByEmail('huesped.008@prueba.com')!;
      expect(account.status).toBe('DESACTIVADA');
      expect(account.deactivatedAt).toEqual(now);
      expect(auth.getSession(guest.token)).toBeUndefined();
      expect(lastDeactivation()).toMatchObject({ actor: guest.email, entityId: guest.userId, result: AuditResult.EXITOSO });
      expect(lastDeactivation()?.detail).not.toMatch(/\b(HU|RF|RN)-\d/);
    });

    it('cierra todas las sesiones abiertas de la cuenta', async () => {
      const first = await registerAndLogin('dos.sesiones@prueba.com', Role.HUESPED);
      const { token } = await auth.login({ email: 'dos.sesiones@prueba.com', password: 'Password123' });

      users.deactivateMyAccount(first, now);

      expect(auth.getSession(token)).toBeUndefined();
    });

    it('conserva el historial: las reservas pasadas, canceladas o pendientes no la impiden ni se borran', async () => {
      const guest = await registerAndLogin('historial@prueba.com', Role.HUESPED);
      booking('pasada', 'demo-bogota-chapinero', guest.email, BookingStatus.COMPLETADA, '2026-10-01', '2026-10-04');
      booking('terminada', 'demo-bogota-chapinero', guest.email, BookingStatus.CONFIRMADA, '2026-11-01', '2026-11-05');
      booking('cancelada', 'demo-bogota-chapinero', guest.email, BookingStatus.CANCELADA, '2026-12-01', '2026-12-04');
      booking('pendiente', 'demo-bogota-chapinero', guest.email, BookingStatus.PENDIENTE, '2026-12-10', '2026-12-12');

      users.deactivateMyAccount(guest, now);

      expect(store.filter((item) => item.guestId === guest.email)).toHaveLength(4);
      expect(auth.findByEmail(guest.email)?.status).toBe('DESACTIVADA');
    });

    it('una cuenta desactivada no puede iniciar sesión', async () => {
      const guest = await registerAndLogin('sin.acceso@prueba.com', Role.HUESPED);
      users.deactivateMyAccount(guest, now);

      await expect(auth.login({ email: 'sin.acceso@prueba.com', password: 'Password123' })).rejects.toThrow(ForbiddenException);
      await expect(auth.login({ email: 'sin.acceso@prueba.com', password: 'Password123' })).rejects.toThrow('Tu cuenta está desactivada');
    });
  });

  describe('CA2 · Con reservas futuras confirmadas', () => {
    it('como huésped: lo impide, muestra las reservas y la cuenta sigue activa', async () => {
      const guest = await registerAndLogin('con.reserva@prueba.com', Role.HUESPED);
      booking('futura', 'demo-bogota-chapinero', guest.email, BookingStatus.CONFIRMADA, '2026-12-10', '2026-12-13');

      let error: ConflictException | undefined;
      try {
        users.deactivateMyAccount(guest, now);
      } catch (caught) {
        error = caught as ConflictException;
      }

      expect(error).toBeInstanceOf(ConflictException);
      expect(error?.getResponse()).toMatchObject({
        code: 'RESERVAS_FUTURAS_CONFIRMADAS',
        message: 'No puedes desactivar tu cuenta: tienes 1 reserva futura confirmada.',
        upcomingBookings: [{ id: 'futura', checkIn: '2026-12-10', checkOut: '2026-12-13', relation: 'HUESPED', guests: 2 }],
      });
      expect(auth.findByEmail(guest.email)?.status).toBe('ACTIVA');
      expect(auth.getSession(guest.token)).toBeDefined();
      expect(lastDeactivation()).toMatchObject({ result: AuditResult.FALLIDO });
    });

    it('como anfitrión: las reservas confirmadas en sus alojamientos también lo impiden y no pausa nada', async () => {
      const host = await registerAndLogin('anfitrion.ocupado@prueba.com', Role.ANFITRION);
      const casa = listing(host, 'Casa en Jardín', ListingStatus.ACTIVA);
      booking('de-un-huesped', casa, 'otro@prueba.com', BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');

      expect(() => users.deactivateMyAccount(host, now)).toThrow(ConflictException);
      expect(listings.getListing(casa)?.status).toBe(ListingStatus.ACTIVA);
      expect(auth.findByEmail(host.email)?.status).toBe('ACTIVA');
    });

    it('una estancia en curso cuenta como futura', async () => {
      const guest = await registerAndLogin('en.curso@prueba.com', Role.HUESPED);
      booking('en-curso', 'demo-bogota-chapinero', guest.email, BookingStatus.CONFIRMADA, '2026-11-04', '2026-11-07');

      expect(users.getDeactivationCheck(guest, now)).toMatchObject({ canDeactivate: false, upcomingBookings: [{ id: 'en-curso' }] });
    });

    it('la revisión previa lista las reservas ordenadas por llegada, con el alojamiento', async () => {
      const host = await registerAndLogin('anfitrion.revision@prueba.com', Role.ANFITRION);
      const casa = listing(host, 'Casa en Jardín', ListingStatus.ACTIVA);
      booking('segunda', casa, 'otro@prueba.com', BookingStatus.CONFIRMADA, '2027-01-10', '2027-01-12');
      booking('primera', casa, 'otro@prueba.com', BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');
      booking('ajena', 'demo-bogota-chapinero', 'otro@prueba.com', BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');

      const check = users.getDeactivationCheck(host, now);

      expect(check.canDeactivate).toBe(false);
      expect(check.upcomingBookings.map((item) => item.id)).toEqual(['primera', 'segunda']);
      expect(check.upcomingBookings[0]).toMatchObject({ listingTitle: 'Casa en Jardín', relation: 'ANFITRION' });
    });
  });

  describe('CA3 · Anfitrión con publicaciones activas', () => {
    it('sus publicaciones ACTIVAS pasan a PAUSADA y las demás no cambian', async () => {
      const host = await registerAndLogin('anfitrion.libre@prueba.com', Role.ANFITRION);
      const activa = listing(host, 'Casa activa', ListingStatus.ACTIVA);
      const otraActiva = listing(host, 'Loft activo', ListingStatus.ACTIVA);
      const borrador = listing(host, 'Borrador', ListingStatus.BORRADOR);

      expect(users.getDeactivationCheck(host, now).listingsToPause.map((item) => item.title)).toEqual(['Casa activa', 'Loft activo']);

      const result = users.deactivateMyAccount(host, now);

      expect(result.pausedListings.map((item) => item.id)).toEqual([activa, otraActiva]);
      expect(listings.getListing(activa)?.status).toBe(ListingStatus.PAUSADA);
      expect(listings.getListing(otraActiva)?.status).toBe(ListingStatus.PAUSADA);
      expect(listings.getListing(borrador)?.status).toBe(ListingStatus.BORRADOR);
      const paused = audit.findAll({ action: AuditAction.LISTING_STATUS_CHANGE }).filter((event) => event.entityId === activa).at(-1);
      expect(paused?.detail).toContain('desactivación de la cuenta del anfitrión');
      expect(lastDeactivation()?.detail).toContain('publicaciones pausadas: 2');
    });

    it('no toca las publicaciones de otros anfitriones', async () => {
      const host = await registerAndLogin('anfitrion.a@prueba.com', Role.ANFITRION);
      const other = await registerAndLogin('anfitrion.b@prueba.com', Role.ANFITRION);
      const ajena = listing(other, 'Casa ajena', ListingStatus.ACTIVA);

      users.deactivateMyAccount(host, now);

      expect(listings.getListing(ajena)?.status).toBe(ListingStatus.ACTIVA);
    });
  });
});
