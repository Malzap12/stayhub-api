import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditResult } from '../../common/enums/audit.enum';
import { CreateListingDto } from '../listings/dto/create-listing.dto';

describe('HU-035 · Consultar las reservas de mis alojamientos (CA1, CA2, RF-049)', () => {
  let controller: BookingsController;
  let bookings: BookingsService;
  let listings: ListingsService;
  let auth: AuthService;
  let audit: AuditService;
  let store: BookingResponseDto[];
  let host: ActiveSession;
  let casa: string;
  let loft: string;

  const session = (userId: string, email: string): ActiveSession => ({
    token: `jwt-${userId}`,
    userId,
    email,
    role: Role.ANFITRION,
    expiresAt: Date.now() + 3_600_000,
  });

  const listingDto = (title: string, city: string): CreateListingDto =>
    ({
      title,
      description: 'Alojamiento de prueba',
      city,
      department: 'Antioquia',
      address: 'Calle 1',
      propertyType: 'CASA',
      maxGuests: 4,
      pricePerNight: 200000,
      amenities: ['WIFI'],
      rules: ['No fumar'],
      images: ['https://images.unsplash.com/photo-1'],
    }) as unknown as CreateListingDto;

  const booking = (id: string, listingId: string, status: BookingStatus, checkIn: string, checkOut: string, guestId = 'ana@prueba.com'): BookingResponseDto => {
    const item: BookingResponseDto = {
      id,
      code: `RES-${id.toUpperCase()}`,
      listingId,
      guestId,
      checkIn,
      checkOut,
      guests: 3,
      totalAmount: 650000,
      currency: 'COP',
      status,
      idempotencyKey: `key-${id}`,
      specialRequests: 'Llegamos en la noche',
      additionalServices: [{ name: 'Desayuno', cost: 40000 }],
      createdAt: new Date('2026-10-01T12:00:00Z'),
    };
    store.push(item);
    return item;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [ListingsService, BookingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService, AuthService],
    }).compile();

    controller = module.get(BookingsController);
    bookings = module.get(BookingsService);
    listings = module.get(ListingsService);
    auth = module.get(AuthService);
    audit = module.get(AuditService);
    store = (bookings as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    store.length = 0;

    await auth.register({ name: 'Ana Restrepo', email: 'ana@prueba.com', password: 'Password123', phone: '3001234567', role: Role.HUESPED });
    await auth.register({ name: 'Bruno Díaz', email: 'bruno@prueba.com', password: 'Password123', role: Role.HUESPED });
    host = session('host-035', 'anfitrion.035@prueba.com');
    loft = listings.create(listingDto('Loft en Laureles', 'Medellín'), host).id;
    casa = listings.create(listingDto('Casa en Jardín', 'Jardín'), host).id;
  });

  describe('CA1 · Reservas recibidas por alojamiento', () => {
    it('agrupa por alojamiento con fechas, noches, huésped, número de huéspedes y estado, por fecha de llegada', () => {
      booking('b2', casa, BookingStatus.CONFIRMADA, '2026-12-20', '2026-12-23');
      booking('b1', casa, BookingStatus.PENDIENTE, '2026-12-01', '2026-12-02', 'bruno@prueba.com');
      booking('b3', loft, BookingStatus.CANCELADA, '2026-11-15', '2026-11-17');

      const groups = controller.findHostBookings(host);

      expect(groups.map((group) => group.listingTitle)).toEqual(['Casa en Jardín', 'Loft en Laureles']);
      expect(groups[0]).toMatchObject({ listingId: casa, listingCity: 'Jardín', listingImage: 'https://images.unsplash.com/photo-1' });
      expect(groups[0].bookings.map((item) => item.id)).toEqual(['b1', 'b2']);
      expect(groups[0].bookings[1]).toMatchObject({
        checkIn: '2026-12-20',
        checkOut: '2026-12-23',
        nights: 3,
        guests: 3,
        guestName: 'Ana Restrepo',
        status: BookingStatus.CONFIRMADA,
      });
      expect(groups[0].bookings[0].guestName).toBe('Bruno Díaz');
    });

    it('el listado no expone el contacto del huésped', () => {
      booking('b1', casa, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');

      const [summary] = controller.findHostBookings(host)[0].bookings;

      expect(summary).not.toHaveProperty('guestContact');
      expect(summary).not.toHaveProperty('guestId');
      expect(JSON.stringify(summary)).not.toContain('ana@prueba.com');
    });

    it('solo incluye las reservas de los alojamientos del anfitrión de la sesión', () => {
      const other = session('host-otro', 'otro@prueba.com');
      const foreign = listings.create(listingDto('Finca ajena', 'Guatapé'), other).id;
      booking('mia', casa, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');
      booking('ajena', foreign, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');

      expect(controller.findHostBookings(host).flatMap((group) => group.bookings.map((item) => item.id))).toEqual(['mia']);
      expect(controller.findHostBookings(other).flatMap((group) => group.bookings.map((item) => item.id))).toEqual(['ajena']);
    });

    it('filtra por estado y omite los alojamientos sin reservas', () => {
      booking('b1', casa, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');
      booking('b2', loft, BookingStatus.CANCELADA, '2026-12-05', '2026-12-06');

      const groups = controller.findHostBookings(host, BookingStatus.CONFIRMADA);

      expect(groups).toHaveLength(1);
      expect(groups[0].listingId).toBe(casa);
    });

    it('sin reservas devuelve una lista vacía', () => {
      expect(controller.findHostBookings(host)).toEqual([]);
    });

    it('si el huésped ya no tiene cuenta muestra un nombre genérico', () => {
      booking('b1', casa, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03', 'sin.cuenta@prueba.com');

      expect(controller.findHostBookings(host)[0].bookings[0].guestName).toBe('Huésped');
    });
  });

  describe('CA2 · Detalle con el contacto del huésped', () => {
    it('con la reserva CONFIRMADA muestra nombre, correo y teléfono del huésped', () => {
      booking('b1', casa, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');

      const detail = controller.findHostBooking('b1', host);

      expect(detail).toMatchObject({
        id: 'b1',
        listingId: casa,
        listingTitle: 'Casa en Jardín',
        nights: 2,
        guests: 3,
        status: BookingStatus.CONFIRMADA,
        specialRequests: 'Llegamos en la noche',
        additionalServices: [{ name: 'Desayuno', cost: 40000 }],
        guestContact: { name: 'Ana Restrepo', email: 'ana@prueba.com', phone: '3001234567' },
      });
    });

    it.each([BookingStatus.PENDIENTE, BookingStatus.CANCELADA, BookingStatus.COMPLETADA, BookingStatus.EN_REVISION])(
      'con la reserva %s no entrega el contacto del huésped',
      (status) => {
        booking('b1', casa, status, '2026-12-01', '2026-12-03');

        const detail = controller.findHostBooking('b1', host);

        expect(detail.guestContact).toBeUndefined();
        expect(detail.guestName).toBe('Ana Restrepo');
      },
    );

    it('la reserva de otro anfitrión responde 404 y queda en la auditoría', () => {
      const other = session('host-otro', 'otro@prueba.com');
      const foreign = listings.create(listingDto('Finca ajena', 'Guatapé'), other).id;
      booking('ajena', foreign, BookingStatus.CONFIRMADA, '2026-12-01', '2026-12-03');

      expect(() => controller.findHostBooking('ajena', host)).toThrow(NotFoundException);
      const event = audit.findAll().find((item) => item.entityId === 'ajena');
      expect(event).toMatchObject({ actor: host.email, result: AuditResult.FALLIDO });
      expect(event?.detail).not.toMatch(/\b(HU|RF|RN)-\d/);
    });

    it('una reserva inexistente responde 404', () => {
      expect(() => controller.findHostBooking('no-existe', host)).toThrow(NotFoundException);
    });
  });
});
