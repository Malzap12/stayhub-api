import { Test, TestingModule } from '@nestjs/testing';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ListingsController } from '../listings/listings.controller';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';

describe('HU-034 · Consultar mi historial de reservas (CA1, CA2 · RF-048, RNF-022)', () => {
  let bookingsController: BookingsController;
  let bookingsService: BookingsService;
  let listingsController: ListingsController;
  let listingId: string;

  const guestSession: ActiveSession = {
    token: 'jwt-guest-34',
    userId: 'user-guest-34',
    email: 'huesped34@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 3_600_000,
  };

  const otherGuestSession: ActiveSession = {
    token: 'jwt-other-34',
    userId: 'user-other-34',
    email: 'otro34@stayhub.com',
    role: Role.HUESPED,
    expiresAt: Date.now() + 3_600_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookingsController = module.get(BookingsController);
    bookingsService = module.get(BookingsService);
    listingsController = module.get(ListingsController);

    const createdListing = listingsController.create(
      {
        title: 'Cabaña Historial Reservas',
        city: 'Santa Marta',
        maxGuests: 4,
        pricePerNight: 200000,
      },
      {
        token: 'jwt-host',
        userId: 'host-1',
        email: 'host@stayhub.com',
        role: Role.ANFITRION,
        expiresAt: Date.now() + 3_600_000,
      },
    );
    listingId = createdListing.id;
    createdListing.status = ListingStatus.ACTIVA;
  });

  it('CA1: devuelve reservas pasadas y futuras ordenadas por fecha de llegada, con soporte de filtro por estado', async () => {
    // Insertamos reservas con fechas desordenadas (pasadas y futuras) y estados distintos
    const store = (bookingsService as unknown as { bookingsStore: unknown[] }).bookingsStore;

    store.push(
      {
        id: 'booking-futura-2',
        listingId,
        guestId: guestSession.email,
        checkIn: '2027-06-15',
        checkOut: '2027-06-20',
        guests: 2,
        totalAmount: 1100000,
        status: BookingStatus.CONFIRMADA,
      },
      {
        id: 'booking-pasada-1',
        listingId,
        guestId: guestSession.email,
        checkIn: '2025-01-10',
        checkOut: '2025-01-15',
        guests: 2,
        totalAmount: 950000,
        status: BookingStatus.COMPLETADA,
      },
      {
        id: 'booking-futura-1',
        listingId,
        guestId: guestSession.email,
        checkIn: '2027-02-01',
        checkOut: '2027-02-05',
        guests: 2,
        totalAmount: 880000,
        status: BookingStatus.PENDIENTE,
      },
      {
        id: 'booking-otro-usuario',
        listingId,
        guestId: otherGuestSession.email,
        checkIn: '2027-01-01',
        checkOut: '2027-01-05',
        guests: 1,
        totalAmount: 500000,
        status: BookingStatus.CONFIRMADA,
      },
    );

    // Consulta general: ordenadas por fecha de llegada (checkIn)
    const allMy = await bookingsController.findMyBookings(guestSession);
    expect(allMy).toHaveLength(3);
    expect(allMy.map((b) => b.id)).toEqual(['booking-pasada-1', 'booking-futura-1', 'booking-futura-2']);
    expect(allMy[0].checkIn).toBe('2025-01-10');
    expect(allMy[1].checkIn).toBe('2027-02-01');
    expect(allMy[2].checkIn).toBe('2027-06-15');

    // Filtro por estado: solo CONFIRMADA
    const confirmed = await bookingsController.findMyBookings(guestSession, BookingStatus.CONFIRMADA);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].id).toBe('booking-futura-2');

    // Filtro por estado: solo COMPLETADA
    const completed = await bookingsController.findMyBookings(guestSession, BookingStatus.COMPLETADA);
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('booking-pasada-1');
  });

  it('CA2: cuando existen muchas reservas, devuelve los resultados paginados según page y limit', async () => {
    const store = (bookingsService as unknown as { bookingsStore: unknown[] }).bookingsStore;

    // Generamos 7 reservas en fechas consecutivas
    for (let i = 1; i <= 7; i++) {
      const day = i < 10 ? `0${i}` : `${i}`;
      store.push({
        id: `booking-${i}`,
        listingId,
        guestId: guestSession.email,
        checkIn: `2027-05-${day}`,
        checkOut: `2027-05-${day}`,
        guests: 2,
        totalAmount: 500000,
        status: BookingStatus.CONFIRMADA,
      });
    }

    // Página 1 con límite 3 -> primeros 3 elementos
    const page1 = await bookingsController.findMyBookings(guestSession, undefined, '1', '3');
    expect(page1).toHaveLength(3);
    expect(page1.map((b) => b.id)).toEqual(['booking-1', 'booking-2', 'booking-3']);

    // Página 2 con límite 3 -> siguientes 3 elementos
    const page2 = await bookingsController.findMyBookings(guestSession, undefined, '2', '3');
    expect(page2).toHaveLength(3);
    expect(page2.map((b) => b.id)).toEqual(['booking-4', 'booking-5', 'booking-6']);

    // Página 3 con límite 3 -> último elemento restante
    const page3 = await bookingsController.findMyBookings(guestSession, undefined, '3', '3');
    expect(page3).toHaveLength(1);
    expect(page3.map((b) => b.id)).toEqual(['booking-7']);
  });
});
