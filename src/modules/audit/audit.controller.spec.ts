import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditController } from './audit.controller';
import { ANONYMOUS_ACTOR, AuditService } from './audit.service';
import { AuthService } from '../auth/auth.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-061 · Registrar los eventos de auditoría (CA1, CA2, CA3, RF-080, RN-021, RN-032)', () => {
  let controller: AuditController;
  let auditService: AuditService;
  let authService: AuthService;
  let listingsService: ListingsService;
  let bookingsService: BookingsService;

  const ADMIN_EMAIL = 'admin.audit@inversioneslr.com';
  const ADMIN_PASSWORD = 'AuditAdmin2026!';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        AuditService,
        AuthService,
        ListingsService,
        BookingsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                ADMIN_INITIAL_EMAIL: ADMIN_EMAIL,
                ADMIN_INITIAL_PASSWORD: ADMIN_PASSWORD,
                ADMIN_INITIAL_NAME: 'Admin Auditoría',
              })[key],
          },
        },
      ],
    }).compile();

    controller = module.get(AuditController);
    auditService = module.get(AuditService);
    authService = module.get(AuthService);
    listingsService = module.get(ListingsService);
    bookingsService = module.get(BookingsService);
    authService.onModuleInit();
  });

  const expectCompleteEvent = (event: Record<string, unknown>) => {
    expect(event).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        actor: expect.any(String),
        action: expect.any(String),
        entity: expect.any(String),
        occurredAt: expect.any(String),
        result: expect.any(String),
      }),
    );
    expect(Number.isNaN(Date.parse(event.occurredAt as string))).toBe(false);
  };

  describe('CA1 · Registro con actor, acción, entidad, fecha y hora y resultado', () => {
    it('registra el inicio de sesión exitoso', async () => {
      await authService.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      const [event] = controller.findAll({ action: AuditAction.LOGIN });
      expectCompleteEvent({ ...event });
      expect(event.actor).toBe(ADMIN_EMAIL);
      expect(event.entity).toBe('AuthSession');
      expect(event.result).toBe(AuditResult.EXITOSO);
    });

    it('registra el cambio de estado de una publicación', async () => {
      const listing = await listingsService.create(
        {
          title: 'Cabaña',
          description: 'Vista al lago',
          address: 'Vereda 1',
          city: 'Guatapé',
          country: 'Colombia',
          pricePerNight: 120,
          maxGuests: 4,
          bedrooms: 2,
          bathrooms: 1,
          amenities: ['WIFI'],
          images: ['https://example.com/cabana.jpg'],
        },
        { token: 't', userId: 'user-9', email: 'anfitrion@stayhub.com', role: Role.ANFITRION, expiresAt: 0 },
      );

      const [event] = controller.findAll({ entity: 'Listing' });
      expectCompleteEvent({ ...event });
      expect(event).toMatchObject({
        actor: 'anfitrion@stayhub.com',
        action: AuditAction.LISTING_STATUS_CHANGE,
        entityId: listing.id,
        result: AuditResult.EXITOSO,
      });
    });

    it('registra la aprobación y la devolución de publicaciones por el administrador (HU-050)', async () => {
      await listingsService.approveListing('pending-listing-1', ADMIN_EMAIL);
      await listingsService.returnListing(
        'pending-listing-2',
        { reason: 'Fotos borrosas' },
        ADMIN_EMAIL,
      );

      const events = controller.findAll({ action: AuditAction.LISTING_STATUS_CHANGE });
      expect(events).toEqual([
        expect.objectContaining({
          actor: ADMIN_EMAIL,
          entityId: 'pending-listing-1',
          result: AuditResult.EXITOSO,
          detail: 'PENDIENTE_REVISION -> ACTIVA',
        }),
        expect.objectContaining({
          actor: ADMIN_EMAIL,
          entityId: 'pending-listing-2',
          result: AuditResult.EXITOSO,
          detail: expect.stringContaining('BORRADOR. Motivo: Fotos borrosas'),
        }),
      ]);
    });

    it('registra el cambio de estado de una reserva', async () => {
      const booking = await bookingsService.createInstant(
        {
          listingId: 'listing-1',
          checkIn: '2026-11-01',
          checkOut: '2026-11-05',
          guests: 2,
          idempotencyKey: '00000000-0000-0000-0000-000000000000',
        },
        'huesped@stayhub.com',
      );

      const [event] = controller.findAll({ entity: 'Booking' });
      expect(event).toMatchObject({
        actor: 'huesped@stayhub.com',
        action: AuditAction.BOOKING_STATUS_CHANGE,
        entityId: booking.id,
        result: AuditResult.EXITOSO,
      });
    });

    it('registra acciones administrativas sobre cuentas', async () => {
      await authService.register({
        name: 'Anfitrión',
        email: 'host@stayhub.com',
        password: 'Password123',
        role: Role.ANFITRION,
      });
      authService.restrictAccount('host@stayhub.com', 'Publicación engañosa', ADMIN_EMAIL);

      const [event] = controller.findAll({ action: AuditAction.ADMIN_ACTION });
      expect(event).toMatchObject({
        actor: ADMIN_EMAIL,
        entity: 'UserAccount',
        result: AuditResult.EXITOSO,
      });
      expect(event.detail).toContain('Publicación engañosa');
    });

    it('permite registrar cancelaciones, reseñas y exportaciones desde otros módulos', () => {
      [AuditAction.BOOKING_CANCELLATION, AuditAction.REVIEW_CREATED, AuditAction.EXPORT].forEach(
        (action) =>
          auditService.record({
            actor: 'usuario@stayhub.com',
            action,
            entity: 'Generic',
            result: AuditResult.EXITOSO,
          }),
      );

      expect(controller.findAll({ actor: 'USUARIO@stayhub.com' })).toHaveLength(3);
    });

    it('usa un actor anónimo cuando la acción no tiene sesión', () => {
      const event = auditService.record({
        action: AuditAction.ACCESS_DENIED,
        entity: 'AuthSession',
        result: AuditResult.FALLIDO,
      });
      expect(event.actor).toBe(ANONYMOUS_ACTOR);
    });
  });

  describe('CA2 · La auditoría es de solo inserción', () => {
    it('no expone operaciones de actualización ni eliminación en el servicio', () => {
      const methods = Object.getOwnPropertyNames(AuditService.prototype);
      expect(methods.sort()).toEqual(['constructor', 'findAll', 'record']);
    });

    it('los eventos registrados son inmutables y la consulta no altera la bitácora', () => {
      const event = auditService.record({
        actor: 'a@stayhub.com',
        action: AuditAction.LOGIN,
        entity: 'AuthSession',
        result: AuditResult.EXITOSO,
      });

      expect(Object.isFrozen(event)).toBe(true);
      expect(() => {
        (event as { result: AuditResult }).result = AuditResult.FALLIDO;
      }).toThrow(TypeError);

      const snapshot = auditService.findAll();
      snapshot.pop();
      expect(auditService.findAll()).toHaveLength(1);
      expect(auditService.findAll()[0].result).toBe(AuditResult.EXITOSO);
    });

    it.each([
      ['PUT', (c: AuditController, id: string) => c.replace(id)],
      ['PATCH', (c: AuditController, id: string) => c.update(id)],
      ['DELETE', (c: AuditController, id: string) => c.remove(id)],
    ])('rechaza %s con 405 y registra el intento como fallido', (_method, invoke) => {
      const original = auditService.record({
        actor: 'a@stayhub.com',
        action: AuditAction.LOGIN,
        entity: 'AuthSession',
        result: AuditResult.EXITOSO,
      });

      let thrown: unknown;
      try {
        invoke(controller, original.id);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(HttpStatus.METHOD_NOT_ALLOWED);

      expect(auditService.findAll()[0]).toEqual(original);
      const [attempt] = controller.findAll({ action: AuditAction.AUDIT_TAMPER_ATTEMPT });
      expect(attempt).toMatchObject({
        entity: 'AuditEvent',
        entityId: original.id,
        result: AuditResult.FALLIDO,
      });
    });
  });

  describe('CA3 · Las acciones fallidas también se registran', () => {
    it('registra el inicio de sesión rechazado con resultado FALLIDO', async () => {
      await expect(
        authService.login({ email: ADMIN_EMAIL, password: 'ClaveIncorrecta1' }),
      ).rejects.toThrow(UnauthorizedException);

      const [event] = controller.findAll({ result: AuditResult.FALLIDO });
      expectCompleteEvent({ ...event });
      expect(event).toMatchObject({
        actor: ADMIN_EMAIL,
        action: AuditAction.LOGIN,
        result: AuditResult.FALLIDO,
      });
    });

    it('registra con resultado FALLIDO los cambios de estado de publicación rechazados', async () => {
      await expect(listingsService.approveListing('no-existe', ADMIN_EMAIL)).rejects.toThrow(
        NotFoundException,
      );
      await listingsService.approveListing('pending-listing-1', ADMIN_EMAIL);
      await expect(
        listingsService.approveListing('pending-listing-1', ADMIN_EMAIL),
      ).rejects.toThrow(BadRequestException);
      await expect(
        listingsService.returnListing('pending-listing-2', { reason: '  ' }, ADMIN_EMAIL),
      ).rejects.toThrow(BadRequestException);
      await expect(
        listingsService.returnListing('no-existe', { reason: 'x' }, ADMIN_EMAIL),
      ).rejects.toThrow(NotFoundException);
      await expect(
        listingsService.returnListing('pending-listing-1', { reason: 'x' }, ADMIN_EMAIL),
      ).rejects.toThrow(BadRequestException);

      const failed = controller.findAll({ entity: 'Listing', result: AuditResult.FALLIDO });
      expect(failed).toHaveLength(5);
      failed.forEach((event) => expect(event.actor).toBe(ADMIN_EMAIL));
    });

    it('registra el acceso sin sesión con resultado FALLIDO', () => {
      expect(() => authService.authorize(undefined, [Role.ADMINISTRADOR])).toThrow(
        UnauthorizedException,
      );

      const [event] = controller.findAll({ action: AuditAction.ACCESS_DENIED });
      expect(event).toMatchObject({ actor: ANONYMOUS_ACTOR, result: AuditResult.FALLIDO });
    });
  });
});
