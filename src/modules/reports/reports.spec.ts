import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportExportService } from './report-export.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, UserAccount } from '../auth/auth.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { ListingResponseDto } from '../listings/dto/listing-response.dto';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

describe('HU-056 · Ver los indicadores del negocio (CA1, CA2, CA3, RF-074, RN-026)', () => {
  let controller: ReportsController;
  let auth: AuthService;
  let users: Map<string, UserAccount>;
  let listings: ListingResponseDto[];
  let bookings: BookingResponseDto[];

  const account = (email: string, role: Role): UserAccount => ({
    id: `id-${email}`,
    name: email,
    email,
    passwordHash: 'x',
    role,
    status: 'ACTIVA',
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });
  const listing = (id: string, city: string, status = ListingStatus.ACTIVA) =>
    ({ id, title: id, city, status, hostId: 'host', createdAt: new Date('2026-10-01T00:00:00Z') }) as unknown as ListingResponseDto;
  let seq = 0;
  const booking = (listingId: string, status: BookingStatus, totalAmount: number, serviceFee: number, currency = 'COP'): BookingResponseDto => ({
    id: `b-${++seq}`,
    listingId,
    guestId: 'h1@prueba.com',
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    guests: 2,
    totalAmount,
    serviceFee,
    currency,
    status,
    idempotencyKey: `k-${seq}`,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [ReportsService, ReportExportService, BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService, AuthService],
    }).compile();

    controller = module.get(ReportsController);
    auth = module.get(AuthService);
    users = (auth as unknown as { users: Map<string, UserAccount> }).users;
    listings = (module.get(ListingsService) as unknown as { listingsStore: ListingResponseDto[] }).listingsStore;
    bookings = (module.get(BookingsService) as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;

    // CA2: conjunto de datos conocido.
    users.clear();
    for (const [email, role] of [
      ['h1@prueba.com', Role.HUESPED], ['h2@prueba.com', Role.HUESPED], ['h3@prueba.com', Role.HUESPED],
      ['a1@prueba.com', Role.ANFITRION], ['a2@prueba.com', Role.ANFITRION],
      ['admin@prueba.com', Role.ADMINISTRADOR],
    ] as Array<[string, Role]>) {
      users.set(email, account(email, role));
    }
    listings.length = 0;
    listings.push(
      listing('med-1', 'Medellín'), listing('med-2', 'Medellín', ListingStatus.PAUSADA), listing('bog', 'Bogotá'),
      listing('ctg', 'Cartagena', ListingStatus.BLOQUEADA), listing('cal', 'Cali'), listing('smr', 'Santa Marta'),
      listing('gtp', 'Guatapé', ListingStatus.BORRADOR), listing('pere', 'Pereira', ListingStatus.PENDIENTE_REVISION),
    );
    bookings.length = 0;
    bookings.push(
      booking('med-1', BookingStatus.CONFIRMADA, 1_000_000, 100_000),
      booking('med-2', BookingStatus.COMPLETADA, 500_000, 50_000),
      booking('med-1', BookingStatus.COMPLETADA, 300_000, 30_000),
      booking('bog', BookingStatus.CONFIRMADA, 800_000, 80_000),
      booking('bog', BookingStatus.CONFIRMADA, 200_000, 20_000),
      booking('ctg', BookingStatus.COMPLETADA, 900_000, 90_000),
      booking('cal', BookingStatus.CONFIRMADA, 400_000, 40_000),
      booking('smr', BookingStatus.CONFIRMADA, 100_000, 10_000),
      booking('gtp', BookingStatus.COMPLETADA, 50_000, 5_000),
      booking('pere', BookingStatus.CANCELADA, 700_000, 70_000),
      booking('pere', BookingStatus.PENDIENTE, 600_000, 60_000),
      booking('cal', BookingStatus.EN_REVISION, 650_000, 65_000),
      booking('bog', BookingStatus.CANCELADA, 120_000, 12_000),
      booking('no-existe', BookingStatus.CONFIRMADA, 10_000, 1_000),
      booking('bog', BookingStatus.CONFIRMADA, 518, 55.5, 'USD'),
    );
  });

  it('CA1: muestra usuarios por rol y publicaciones ACTIVAS', () => {
    const dashboard = controller.getDashboard();

    expect(dashboard.usersByRole).toEqual({ HUESPED: 3, ANFITRION: 2, ADMINISTRADOR: 1, total: 6 });
    expect(dashboard.activeListings).toBe(4);
  });

  it('CA1: cuenta las reservas por estado, incluidos los estados sin reservas', () => {
    expect(controller.getDashboard().bookingsByStatus).toEqual({
      PENDIENTE: 1,
      CONFIRMADA: 7,
      CANCELADA: 2,
      COMPLETADA: 4,
      EN_REVISION: 1,
      total: 15,
    });

    bookings.length = 0;
    expect(controller.getDashboard().bookingsByStatus).toEqual({ PENDIENTE: 0, CONFIRMADA: 0, CANCELADA: 0, COMPLETADA: 0, EN_REVISION: 0, total: 0 });
  });

  it('CA1 (AMB-24): los ingresos estimados suman las reservas CONFIRMADAS y COMPLETADAS en COP', () => {
    expect(controller.getDashboard().estimatedRevenue).toEqual({
      currency: 'COP',
      // 1.000.000 + 500.000 + 300.000 + 800.000 + 200.000 + 900.000 + 400.000 + 100.000 + 50.000 + 10.000
      grossBookingValue: 4_260_000,
      platformFees: 426_000,
      bookings: 10,
    });
  });

  it('CA1 (AMB-25): las 5 ciudades con más reservas CONFIRMADAS y COMPLETADAS, de mayor a menor', () => {
    expect(controller.getDashboard().topCities).toEqual([
      { city: 'Medellín', bookings: 3, grossBookingValue: 1_800_000 },
      { city: 'Bogotá', bookings: 2, grossBookingValue: 1_000_000 },
      // Empate en reservas: primero la de mayor valor.
      { city: 'Cartagena', bookings: 1, grossBookingValue: 900_000 },
      { city: 'Cali', bookings: 1, grossBookingValue: 400_000 },
      { city: 'Santa Marta', bookings: 1, grossBookingValue: 100_000 },
    ]);
  });

  it('sin datos devuelve todos los indicadores en cero', () => {
    users.clear();
    listings.length = 0;
    bookings.length = 0;

    const dashboard = controller.getDashboard();
    expect(dashboard.usersByRole.total).toBe(0);
    expect(dashboard.activeListings).toBe(0);
    expect(dashboard.estimatedRevenue).toMatchObject({ grossBookingValue: 0, platformFees: 0, bookings: 0 });
    expect(dashboard.topCities).toEqual([]);
  });

  describe('CA3: solo el administrador abre el dashboard', () => {
    const guard = () => new RolesGuard(new Reflector(), auth);
    const contextFor = (token?: string) =>
      ({
        getHandler: () => ReportsController.prototype.getDashboard,
        getClass: () => ReportsController,
        switchToHttp: () => ({ getRequest: () => ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) }),
      }) as never;
    const tokenOf = async (email: string, role: Role) => {
      await auth.register({ name: email, email, password: 'Password123', role } as never);
      return (await auth.login({ email, password: 'Password123' } as never)).token;
    };

    it('el huésped y el anfitrión reciben 403, sin sesión 401 y el administrador entra', async () => {
      const guest = await tokenOf('h56@prueba.com', Role.HUESPED);
      const host = await tokenOf('a56@prueba.com', Role.ANFITRION);
      users.set('admin56@prueba.com', { ...account('admin56@prueba.com', Role.ADMINISTRADOR), passwordHash: auth.hashPassword('Password123') });
      const admin = (await auth.login({ email: 'admin56@prueba.com', password: 'Password123' } as never)).token;

      expect(() => guard().canActivate(contextFor(guest))).toThrow(ForbiddenException);
      expect(() => guard().canActivate(contextFor(host))).toThrow(ForbiddenException);
      expect(() => guard().canActivate(contextFor())).toThrow(UnauthorizedException);
      expect(guard().canActivate(contextFor(admin))).toBe(true);
    });
  });
});
