import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingResponseDto } from './dto/booking-response.dto';

describe('HU-033 · Consultar el estado de mis reservas (CA1, CA2, RF-047)', () => {
  let bookings: BookingsController;
  let bookingsService: BookingsService;
  let listings: ListingsController;
  let audit: AuditService;
  let booking: BookingResponseDto;

  const session = (role: Role, name: string): ActiveSession => ({
    token: `jwt-${name}`,
    userId: `user-${name}`,
    email: `${name}@stayhub.com`,
    role,
    expiresAt: Date.now() + 3_600_000,
  });
  const host = session(Role.ANFITRION, 'anfitrion33');
  const guest = session(Role.HUESPED, 'huesped33');
  const otherGuest = session(Role.HUESPED, 'huesped33b');
  const admin = session(Role.ADMINISTRADOR, 'admin33');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController, ListingsController],
      providers: [BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService],
    }).compile();

    bookings = module.get(BookingsController);
    bookingsService = module.get(BookingsService);
    listings = module.get(ListingsController);
    audit = module.get(AuditService);

    const listing = listings.create(
      {
        title: 'Cabaña HU-033',
        city: 'Guatapé',
        pricePerNight: 250000,
        maxGuests: 4,
        images: ['https://img.example/cabana-33.jpg'],
      },
      host,
    );
    // Tarifas de la publicación (HU-015) y servicios adicionales (HU-027).
    Object.assign(listing, { cleaningFee: 60000, additionalServices: [{ name: 'Desayuno', cost: 40000 }] });
    await listings.registerAvailabilityPeriod(listing.id, { startDate: '2027-04-01', endDate: '2027-04-30' }, host);
    listing.status = ListingStatus.ACTIVA;
    booking = await bookings.createInstant(
      {
        listingId: listing.id,
        checkIn: '2027-04-10',
        checkOut: '2027-04-13',
        guests: 3,
        additionalServices: ['Desayuno'],
        idempotencyKey: '33000000-0000-4000-8000-000000000001',
        card: { cardNumber: '4242424242424242', cardHolder: 'Huésped', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123' },
      },
      guest,
    );
  });

  describe('CA1 · Al abrir una reserva veo alojamiento, fechas, huéspedes, desglose, política y estado', () => {
    it('devuelve todos los datos de la reserva', async () => {
      const detail = await bookings.findOne(booking.id, guest);

      expect(detail).toMatchObject({
        id: booking.id,
        status: BookingStatus.CONFIRMADA,
        listingTitle: 'Cabaña HU-033',
        listingCity: 'Guatapé',
        listingImage: 'https://img.example/cabana-33.jpg',
        checkIn: '2027-04-10',
        checkOut: '2027-04-13',
        guests: 3,
        nights: 3,
        nightlyRate: 250000,
        baseAmount: 750000,
        cleaningFee: 60000,
        additionalServices: [{ name: 'Desayuno', cost: 40000 }],
        currency: 'COP',
        cancellationPolicyName: 'Flexible',
      });
      expect(detail.cancellationPolicyDescription).toContain('48 horas antes de la llegada');
      expect(detail.serviceFee).toBeGreaterThan(0);
      expect(detail.totalAmount).toBe(detail.subtotal! + detail.serviceFee!);
      expect(detail.payment?.status).toBe('APROBADO');
    });

    it('muestra el estado actual: también una reserva CANCELADA con su registro', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-04-01T12:00:00Z'));
      await bookings.cancelBooking(booking.id, { reason: 'Viaje aplazado' }, guest);
      jest.restoreAllMocks();

      const detail = await bookings.findOne(booking.id, guest);

      expect(detail.status).toBe(BookingStatus.CANCELADA);
      expect(detail.cancellation).toMatchObject({ reason: 'Viaje aplazado', finalStatus: 'CANCELADA' });
    });

    it('no modifica la reserva guardada al agregar los datos del alojamiento', async () => {
      await bookings.findOne(booking.id, guest);
      expect(booking).not.toHaveProperty('listingTitle');
    });

    it('un administrador también puede consultarla', async () => {
      expect((await bookings.findOne(booking.id, admin)).id).toBe(booking.id);
    });
  });

  describe('CA2 · La reserva de otro huésped no se puede consultar', () => {
    it('responde 403 a otro huésped y registra el intento', async () => {
      await expect(bookings.findOne(booking.id, otherGuest)).rejects.toThrow(ForbiddenException);
      await expect(bookings.findOne(booking.id, host)).rejects.toThrow('Esta reserva es de otro huésped; solo puedes consultar tus reservas');

      const [event] = audit.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE, actor: otherGuest.email });
      expect(event).toMatchObject({ entityId: booking.id, result: AuditResult.FALLIDO, detail: 'Consulta rechazada: la reserva es de otro huésped' });
    });

    it('responde 404 si la reserva no existe, en vez de inventar una', async () => {
      await expect(bookings.findOne('no-existe', guest)).rejects.toThrow(NotFoundException);
    });
  });

  it('una reserva de una publicación que ya no existe se devuelve sin datos del alojamiento', async () => {
    const detail = await bookingsService.findOne('mock-booking-uuid-1');
    expect(detail.id).toBe('mock-booking-uuid-1');
    expect(detail.listingTitle).toBeUndefined();
  });
});
