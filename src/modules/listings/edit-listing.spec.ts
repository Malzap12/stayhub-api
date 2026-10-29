import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService } from '../auth/auth.service';
import { BookingsService } from '../bookings/bookings.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';

describe('HU-011 · Editar mi publicación (CA1, CA2, CA3, RF-015, RN-003, RN-021)', () => {
  let controller: ListingsController;
  let listingsService: ListingsService;
  let auditService: AuditService;
  let authService: AuthService;
  let bookingsService: BookingsService;
  let host: ActiveSession;
  let otherHost: ActiveSession;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService, AuthService, BookingsService],
    }).compile();

    controller = module.get(ListingsController);
    listingsService = module.get(ListingsService);
    auditService = module.get(AuditService);
    authService = module.get(AuthService);
    bookingsService = module.get(BookingsService);
    authService.onModuleInit();

    const hostEmail = 'propietario.hu011@stayhub.com';
    await authService.register({ name: 'Host Propietario', email: hostEmail, password: 'Password123', role: Role.ANFITRION } as never);
    const loginHost = await authService.login({ email: hostEmail, password: 'Password123' } as never);
    host = authService.getSession(loginHost.token)!;

    const otherEmail = 'ajeno.hu011@stayhub.com';
    await authService.register({ name: 'Otro Host', email: otherEmail, password: 'Password123', role: Role.ANFITRION } as never);
    const loginOther = await authService.login({ email: otherEmail, password: 'Password123' } as never);
    otherHost = authService.getSession(loginOther.token)!;
  });

  describe('CA1: anfitrión propietario modifica datos válidos y se registra evento de auditoría', () => {
    it('guarda los cambios correctamente y registra evento LISTING_UPDATE en auditoría', () => {
      const created = controller.create({ title: 'Cabaña Inicial' }, host);

      const updated = controller.update(
        created.id,
        {
          title: 'Cabaña en la Montaña Renovada',
          description: 'Hermosa vista y chimenea de leña',
          city: 'Guatapé',
          department: 'Antioquia',
          address: 'Vereda El Peñol km 4',
          propertyType: PropertyType.CABANA,
          maxGuests: 5,
          pricePerNight: 280000,
          bedrooms: 2,
          bathrooms: 2,
          amenities: ['WIFI', 'CHIMENEA', 'JACUZZI'],
          rules: ['No fumar', 'No fiestas'],
          images: ['https://example.com/cabana1.jpg'],
        },
        host,
      );

      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe('Cabaña en la Montaña Renovada');
      expect(updated.city).toBe('Guatapé');
      expect(updated.maxGuests).toBe(5);
      expect(updated.pricePerNight).toBe(280000);
      expect(updated.amenities).toEqual(['WIFI', 'CHIMENEA', 'JACUZZI']);
      expect(updated.isComplete).toBe(true);

      const events = auditService.findAll({ action: AuditAction.LISTING_UPDATE });
      expect(events.length).toBeGreaterThan(0);
      const auditEvent = events.find((e) => e.entityId === created.id);
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.actor).toBe(host.email);
      expect(auditEvent?.result).toBe(AuditResult.EXITOSO);
    });

    it('editar una publicación ACTIVA conserva su estado sin exigir nueva revisión (AMB-29)', () => {
      const listing = controller.create(
        {
          title: 'Apartamento de Lujo',
          description: 'Completamente equipado y céntrico',
          city: 'Medellín',
          department: 'Antioquia',
          address: 'El Poblado Cl 10',
          propertyType: PropertyType.APARTAMENTO,
          maxGuests: 4,
          pricePerNight: 350000,
          bedrooms: 2,
          bathrooms: 2,
          amenities: ['WIFI', 'PARQUEADERO'],
          rules: ['No fumar'],
          images: ['https://example.com/apto.jpg'],
        },
        host,
      );

      // Simular aprobación previa a ACTIVA
      listing.status = ListingStatus.ACTIVA;

      const updated = controller.update(
        listing.id,
        {
          description: 'Descripción actualizada con amenidades adicionales',
          pricePerNight: 380000,
        },
        host,
      );

      expect(updated.status).toBe(ListingStatus.ACTIVA);
      expect(updated.pricePerNight).toBe(380000);
    });

    it('valida que no se ingresen datos inconsistentes (título corto, capacidad o precio <= 0)', () => {
      const created = controller.create({ title: 'Cabaña Para Pruebas' }, host);

      expect(() => controller.update(created.id, { title: 'No' }, host)).toThrow(BadRequestException);
      expect(() => controller.update(created.id, { maxGuests: 0 }, host)).toThrow(BadRequestException);
      expect(() => controller.update(created.id, { pricePerNight: -100 }, host)).toThrow(BadRequestException);
      expect(() => controller.update(created.id, { bedrooms: -1 }, host)).toThrow(BadRequestException);
      expect(() => controller.update(created.id, { bathrooms: -1 }, host)).toThrow(BadRequestException);
      expect(() => controller.update(created.id, { cancellationPolicy: 'INVALID' as any }, host)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('CA2: otro anfitrión intenta editar publicación ajena', () => {
    it('el sistema impide la edición a otro anfitrión lanzando NotFoundException (RN-005)', () => {
      const created = controller.create({ title: 'Casa Exclusiva' }, host);

      expect(() =>
        controller.update(
          created.id,
          {
            title: 'Intento de Modificación Ajena',
          },
          otherHost,
        ),
      ).toThrow(NotFoundException);
    });
  });

  describe('CA3: publicación con reservas confirmadas conserva condiciones originales al editar precio o política', () => {
    it('las reservas existentes conservan la tarifa y condiciones con que fueron confirmadas', async () => {
      const listing = controller.create(
        {
          title: 'Casa Campestre para Reservas',
          description: 'Casa campestre amplia y tranquila',
          city: 'Cali',
          department: 'Valle del Cauca',
          address: 'Km 18 vía al mar',
          propertyType: PropertyType.CASA,
          maxGuests: 6,
          pricePerNight: 200000,
          bedrooms: 3,
          bathrooms: 2,
          amenities: ['WIFI', 'PISCINA'],
          rules: ['No ruido tarde'],
          images: ['https://example.com/casa.jpg'],
          cancellationPolicy: 'FLEXIBLE',
        },
        host,
      );
      listing.status = ListingStatus.ACTIVA;

      // Habilitar periodo disponible para poder cotizar y reservar
      await listingsService.registerAvailabilityPeriod(
        listing.id,
        { startDate: '2026-11-01', endDate: '2026-11-30' },
        host,
      );

      // Crear reserva confirmada con el precio original de 200,000
      const booking = await bookingsService.createInstant(
        {
          listingId: listing.id,
          checkIn: '2026-11-20',
          checkOut: '2026-11-23', // 3 noches
          guests: 2,
          idempotencyKey: '00000000-0000-0000-0000-000000000011',
        },
        'guest.hu011@stayhub.com',
      );
      booking.status = BookingStatus.CONFIRMADA;
      const initialTotal = booking.totalAmount;
      const initialNightlyRate = booking.nightlyRate;

      // Host edita la publicación aumentando el precio y cambiando detalles
      controller.update(
        listing.id,
        {
          pricePerNight: 450000, // Aumento sustancial de precio
          title: 'Casa Campestre Premium',
        },
        host,
      );

      // Verificar que la reserva confirmada mantiene su tarifa y total previo
      const bookingAfterEdit = await bookingsService.findOne(booking.id);
      expect(bookingAfterEdit.nightlyRate).toBe(initialNightlyRate);
      expect(bookingAfterEdit.totalAmount).toBe(initialTotal);
      expect(bookingAfterEdit.status).toBe(BookingStatus.CONFIRMADA);
      expect(bookingAfterEdit.nightlyRate).not.toBe(450000);
    });
  });
});
