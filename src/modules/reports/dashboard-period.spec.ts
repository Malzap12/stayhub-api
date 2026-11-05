import { BadRequestException } from '@nestjs/common';
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
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { ListingResponseDto } from '../listings/dto/listing-response.dto';

describe('HU-057 · Filtrar el dashboard por periodo (CA1 · RF-075)', () => {
  let controller: ReportsController;
  let service: ReportsService;
  let bookings: BookingResponseDto[];

  let seq = 0;
  const booking = (
    listingId: string,
    status: BookingStatus,
    totalAmount: number,
    serviceFee: number,
    createdAt: Date,
  ): BookingResponseDto => ({
    id: `b-period-${++seq}`,
    listingId,
    guestId: 'guest@prueba.com',
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    guests: 2,
    totalAmount,
    serviceFee,
    currency: 'COP',
    status,
    idempotencyKey: `k-period-${seq}`,
    createdAt,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ReportsService,
        ReportExportService,
        BookingsService,
        ListingsService,
        PlatformConfigService,
        AuditService,
        PaymentsService,
        NotificationsService,
        AuthService,
      ],
    }).compile();

    controller = module.get(ReportsController);
    service = module.get(ReportsService);

    const auth = module.get(AuthService);
    const users = (auth as unknown as { users: Map<string, UserAccount> }).users;
    users.clear();
    users.set('admin@prueba.com', {
      id: 'admin-id',
      name: 'Admin',
      email: 'admin@prueba.com',
      passwordHash: 'x',
      role: Role.ADMINISTRADOR,
      status: 'ACTIVA',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    });

    const listings = (module.get(ListingsService) as unknown as { listingsStore: ListingResponseDto[] }).listingsStore;
    listings.length = 0;
    listings.push(
      { id: 'list-bogota', title: 'Apto Bogotá', city: 'Bogotá', status: ListingStatus.ACTIVA, hostId: 'h1', createdAt: new Date('2026-09-01T00:00:00Z') } as unknown as ListingResponseDto,
      { id: 'list-medellin', title: 'Casa Medellín', city: 'Medellín', status: ListingStatus.ACTIVA, hostId: 'h2', createdAt: new Date('2026-09-01T00:00:00Z') } as unknown as ListingResponseDto,
    );

    bookings = (module.get(BookingsService) as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    bookings.length = 0;

    // Reservas en diferentes fechas:
    // Octubre 2026 (2026-10-10):
    bookings.push(
      booking('list-bogota', BookingStatus.CONFIRMADA, 500_000, 50_000, new Date('2026-10-10T15:00:00Z')),
      booking('list-medellin', BookingStatus.COMPLETADA, 300_000, 30_000, new Date('2026-10-15T15:00:00Z')),
      booking('list-bogota', BookingStatus.CANCELADA, 200_000, 20_000, new Date('2026-10-20T15:00:00Z')),
    );
    // Noviembre 2026 (2026-11-05):
    bookings.push(
      booking('list-medellin', BookingStatus.CONFIRMADA, 1_000_000, 100_000, new Date('2026-11-05T15:00:00Z')),
      booking('list-bogota', BookingStatus.PENDIENTE, 400_000, 40_000, new Date('2026-11-08T15:00:00Z')),
    );
  });

  it('CA1 · Sin filtro de periodo, incluye todas las reservas en los indicadores', () => {
    const dash = controller.getDashboard();
    expect(dash.bookingsByStatus.total).toBe(5);
    expect(dash.bookingsByStatus.CONFIRMADA).toBe(2);
    expect(dash.bookingsByStatus.COMPLETADA).toBe(1);
    expect(dash.bookingsByStatus.CANCELADA).toBe(1);
    expect(dash.bookingsByStatus.PENDIENTE).toBe(1);
    // Ingresos: 500k + 300k + 1000k = 1.8M
    expect(dash.estimatedRevenue.grossBookingValue).toBe(1_800_000);
    expect(dash.estimatedRevenue.platformFees).toBe(180_000);
    expect(dash.estimatedRevenue.bookings).toBe(3);
    expect(dash.period).toBeUndefined();
  });

  it('CA1 · Al filtrar por rango de fechas (octubre), recalcula reservas, ingresos y demanda para ese rango', () => {
    const dash = controller.getDashboard({ from: '2026-10-01', to: '2026-10-31' });

    expect(dash.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(dash.bookingsByStatus.total).toBe(3);
    expect(dash.bookingsByStatus.CONFIRMADA).toBe(1);
    expect(dash.bookingsByStatus.COMPLETADA).toBe(1);
    expect(dash.bookingsByStatus.CANCELADA).toBe(1);
    expect(dash.bookingsByStatus.PENDIENTE).toBe(0);

    // Ingresos de octubre: 500k + 300k = 800k
    expect(dash.estimatedRevenue.grossBookingValue).toBe(800_000);
    expect(dash.estimatedRevenue.platformFees).toBe(80_000);
    expect(dash.estimatedRevenue.bookings).toBe(2);

    // Demanda de octubre: Bogotá (1) y Medellín (1)
    expect(dash.topCities).toHaveLength(2);
  });

  it('CA1 · Al filtrar por rango de fechas (noviembre), recalcula para noviembre', () => {
    const dash = controller.getDashboard({ from: '2026-11-01', to: '2026-11-30' });

    expect(dash.period).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(dash.bookingsByStatus.total).toBe(2);
    expect(dash.bookingsByStatus.CONFIRMADA).toBe(1);
    expect(dash.bookingsByStatus.PENDIENTE).toBe(1);
    expect(dash.bookingsByStatus.CANCELADA).toBe(0);

    // Ingresos de noviembre: solo la confirmada de 1M
    expect(dash.estimatedRevenue.grossBookingValue).toBe(1_000_000);
    expect(dash.estimatedRevenue.platformFees).toBe(100_000);
    expect(dash.estimatedRevenue.bookings).toBe(1);

    // Demanda: solo Medellín
    expect(dash.topCities).toHaveLength(1);
    expect(dash.topCities[0].city).toBe('Medellín');
  });

  it('Rechaza si la fecha inicial es posterior a la fecha final con BadRequestException', () => {
    expect(() => controller.getDashboard({ from: '2026-11-30', to: '2026-11-01' })).toThrow(BadRequestException);
  });
});
