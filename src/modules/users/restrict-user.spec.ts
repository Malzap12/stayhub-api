import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';

describe('HU-053 · Restringir a un usuario (CA1, CA2, CA3 · RF-070, RF-071, RN-020, RN-021)', () => {
  let controller: UsersController;
  let usersService: UsersService;
  let authService: AuthService;
  let listingsService: ListingsService;
  let bookingsService: BookingsService;

  const adminSession = {
    userId: 'admin-id',
    email: 'admin@inversioneslr.com',
    role: Role.ADMINISTRADOR,
    token: 'jwt-admin',
    name: 'Administrador StayHub',
    expiresAt: Date.now() + 3600_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        AuthService,
        AuditService,
        ListingsService,
        BookingsService,
      ],
    }).compile();

    controller = module.get(UsersController);
    usersService = module.get(UsersService);
    authService = module.get(AuthService);
    listingsService = module.get(ListingsService);
    bookingsService = module.get(BookingsService);

    authService.onModuleInit();
    listingsService.onModuleInit();
    bookingsService.onModuleInit();
  });

  it('CA1: cuando un usuario activo es restringido con motivo, no puede iniciar sesión y su sesión vigente se invalida', async () => {
    // 1. Registrar y loguear un usuario huésped
    const email = 'huesped.hu053@stayhub.com';
    const password = 'Password123!';
    await authService.register({
      name: 'Huésped Cincuenta y Tres',
      email,
      password,
      role: Role.HUESPED,
    });
    const loginRes = await authService.login({ email, password });
    expect(authService.isSessionValid(loginRes.token)).toBe(true);

    // 2. Administrador restringe al usuario indicando el motivo
    const reason = 'Incumplimiento reiterado de normas de convivencia';
    const restrictRes = controller.restrictUser(email, { reason }, adminSession);
    expect(restrictRes.status).toBe('RESTRINGIDA');
    expect(restrictRes.restrictionReason).toBe(reason);

    // 3. Su sesión vigente queda inmediatamente invalidada
    expect(authService.isSessionValid(loginRes.token)).toBe(false);
    expect(authService.getSession(loginRes.token)).toBeUndefined();

    // 4. No puede volver a iniciar sesión (recibe 403 con mensaje de cuenta restringida)
    await expect(authService.login({ email, password })).rejects.toThrow(ForbiddenException);
    try {
      await authService.login({ email, password });
    } catch (err: any) {
      expect(err.response?.message).toContain('tu cuenta se encuentra restringida');
      expect(err.response?.message).toContain(reason);
    }
  });

  it('CA2: cuando el usuario restringido es anfitrión, sus publicaciones ACTIVAS pasan a PAUSADA y sus reservas futuras a EN_REVISION', async () => {
    const hostEmail = 'anfitrion.hu053@stayhub.com';
    const password = 'Password123!';
    await authService.register({
      name: 'Anfitrión Cincuenta y Tres',
      email: hostEmail,
      password,
      role: Role.ANFITRION,
    });
    const hostUser = authService.findByEmail(hostEmail)!;
    const hostSession = { userId: hostUser.id, email: hostUser.email, role: Role.ANFITRION, token: 'jwt-host', expiresAt: Date.now() + 3600_000 };

    // Crear publicaciones para este anfitrión: una ACTIVA
    const activeListing = listingsService.create(
      {
        title: 'Alojamiento Activo del Anfitrión',
        city: 'Bogotá',
        department: 'Cundinamarca',
        address: 'Calle 100 # 15-20',
        propertyType: 'APARTAMENTO' as any,
        pricePerNight: 200000,
        maxGuests: 4,
        amenities: ['WIFI', 'AC'],
        images: ['https://example.com/img1.jpg'],
      },
      hostSession,
    );
    // Marcar como ACTIVA
    const listingRecord = listingsService.getListing(activeListing.id)!;
    listingRecord.status = ListingStatus.ACTIVA;
    expect(listingRecord.status).toBe(ListingStatus.ACTIVA);

    // Registrar periodo disponible y crear una reserva futura
    await listingsService.registerAvailabilityPeriod(
      activeListing.id,
      { startDate: '2026-11-01', endDate: '2026-12-31' },
      hostSession,
    );

    const booking = await bookingsService.createInstant(
      {
        listingId: activeListing.id,
        checkIn: '2026-11-20',
        checkOut: '2026-11-25',
        guests: 2,
        idempotencyKey: 'idemp-key-53',
      },
      'guest@stayhub.com',
    );
    expect(booking.status).toBe(BookingStatus.PENDIENTE);

    // Restringir al anfitrión
    const reason = 'Cancelaciones fraudulentas reportadas por huéspedes';
    const restrictRes = controller.restrictUser(hostUser.id, { reason }, adminSession);

    // Publicación ACTIVA pasó a PAUSADA
    expect(listingsService.getListing(activeListing.id)!.status).toBe(ListingStatus.PAUSADA);
    expect(restrictRes.pausedListings).toContain(activeListing.id);

    // Reserva futura pasó a EN_REVISION
    const updatedBooking = bookingsService.getBookingRecord(booking.id);
    expect(updatedBooking.status).toBe(BookingStatus.EN_REVISION);
    expect(updatedBooking.reviewReason).toContain('Anfitrión restringido');
  });

  it('CA3: cuando se levanta la restricción, el usuario puede iniciar sesión de nuevo y sus publicaciones siguen PAUSADAS hasta reactivarlas', async () => {
    const hostEmail = 'anfitrion.reactiva@stayhub.com';
    const password = 'Password123!';
    await authService.register({
      name: 'Anfitrión Reactivable',
      email: hostEmail,
      password,
      role: Role.ANFITRION,
    });
    const hostUser = authService.findByEmail(hostEmail)!;
    const hostSession = { userId: hostUser.id, email: hostUser.email, role: Role.ANFITRION, token: 'jwt-host-r', expiresAt: Date.now() + 3600_000 };

    const listing = listingsService.create(
      {
        title: 'Cabaña de Montaña',
        city: 'Medellín',
        department: 'Antioquia',
        address: 'Vereda El Salto',
        propertyType: 'CABANA' as any,
        pricePerNight: 180000,
        maxGuests: 2,
        amenities: ['WIFI'],
        images: ['https://example.com/cabana.jpg'],
      },
      hostSession,
    );
    const listingRecord = listingsService.getListing(listing.id)!;
    listingRecord.status = ListingStatus.ACTIVA;

    // 1. Restringir
    controller.restrictUser(hostUser.id, { reason: 'Investigación preventiva de cuenta' }, adminSession);
    expect(listingsService.getListing(listing.id)!.status).toBe(ListingStatus.PAUSADA);

    // 2. Levantar la restricción
    const unrestrictRes = controller.unrestrictUser(hostUser.id, adminSession);
    expect(unrestrictRes.status).toBe('ACTIVA');

    // 3. Puede iniciar sesión de nuevo
    const newLogin = await authService.login({ email: hostEmail, password });
    expect(newLogin.token).toBeDefined();

    // 4. Sus publicaciones siguen PAUSADAS
    expect(listingsService.getListing(listing.id)!.status).toBe(ListingStatus.PAUSADA);

    // 5. El anfitrión puede reactivarla cuando lo desee
    const reactivated = listingsService.reactivateListing(listing.id, hostSession);
    expect(reactivated.status).toBe(ListingStatus.ACTIVA);
    expect(listingsService.getListing(listing.id)!.status).toBe(ListingStatus.ACTIVA);
  });

  it('valida que no se pueda restringir a un administrador ni enviar motivo vacío', async () => {
    const admin = authService.findByEmail('admin@inversioneslr.com')!;
    expect(() => controller.restrictUser(admin.id, { reason: 'Motivo de prueba' }, adminSession)).toThrow(ForbiddenException);

    expect(() => controller.restrictUser('usuario-inexistente', { reason: 'Motivo válido' }, adminSession)).toThrow(NotFoundException);
    expect(() => controller.restrictUser(admin.id, { reason: '   ' }, adminSession)).toThrow(BadRequestException);
    expect(() => controller.restrictUser(admin.id, { reason: 'abc' }, adminSession)).toThrow(BadRequestException);
  });
});
