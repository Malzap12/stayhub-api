import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, ActiveSession } from './auth.service';
import { ReactivateAccountDto } from './dto/auth.dto';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateListingDto } from '../listings/dto/create-listing.dto';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-009 · Reactivar mi cuenta (CA1, CA2, RF-012, RN-021)', () => {
  let controller: AuthController;
  let auth: AuthService;
  let audit: AuditService;
  let users: UsersService;
  let listings: ListingsService;

  const password = 'Password123';

  /** Registra, inicia sesión y desactiva la cuenta (HU-008); devuelve la sesión que tenía. */
  const deactivated = async (email: string, role: Role.HUESPED | Role.ANFITRION = Role.HUESPED, before?: (session: ActiveSession) => void) => {
    await auth.register({ name: 'Usuario Prueba', email, password, role });
    const session = auth.getSession((await auth.login({ email, password })).token) as ActiveSession;
    before?.(session);
    users.deactivateMyAccount(session);
    return session;
  };

  /** CA1: el inicio de sesión con credenciales correctas responde 403 y ofrece reactivar. */
  const offer = async (email: string) => {
    try {
      await controller.login({ email, password });
    } catch (error) {
      return (error as ForbiddenException).getResponse() as { reason: string; message: string; reactivationToken: string; reactivationExpiresInMinutes: number };
    }
    throw new Error('El inicio de sesión debía rechazarse');
  };

  const lastReactivation = () => audit.findAll({ action: AuditAction.ACCOUNT_REACTIVATION }).at(-1);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService, AuditService, UsersService, ListingsService, BookingsService, PlatformConfigService, PaymentsService, NotificationsService],
    }).compile();

    controller = module.get(AuthController);
    auth = module.get(AuthService);
    audit = module.get(AuditService);
    users = module.get(UsersService);
    listings = module.get(ListingsService);
  });

  describe('CA1 · Al iniciar sesión con la cuenta desactivada se ofrece reactivarla', () => {
    it('con credenciales correctas responde 403 con la oferta y un token de reactivación, sin abrir sesión', async () => {
      await deactivated('ofrecer@prueba.com');

      const response = await offer('ofrecer@prueba.com');

      expect(response).toMatchObject({ reason: 'CUENTA_DESACTIVADA', reactivationExpiresInMinutes: 10 });
      expect(response.message).toContain('¿Quieres reactivarla?');
      expect(response.reactivationToken).toMatch(/^[0-9a-f]{32}$/);
      expect(auth.findByEmail('ofrecer@prueba.com')?.status).toBe('DESACTIVADA');
    });

    it('con la contraseña incorrecta no revela que la cuenta está desactivada', async () => {
      await deactivated('clave.mala@prueba.com');

      await expect(controller.login({ email: 'clave.mala@prueba.com', password: 'OtraClave123' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('CA2 · Al confirmar la cuenta vuelve a ACTIVA', () => {
    it('reactiva la cuenta, abre la sesión y registra el evento', async () => {
      await deactivated('volver@prueba.com');
      const { reactivationToken } = await offer('volver@prueba.com');
      const now = new Date();

      const result = auth.reactivate({ reactivationToken }, now);

      expect(result.message).toBe('Tu cuenta se reactivó. ¡Qué bueno tenerte de vuelta!');
      expect(result.user).toMatchObject({ email: 'volver@prueba.com', status: 'ACTIVA' });
      expect(auth.getSession(result.token)).toMatchObject({ email: 'volver@prueba.com' });
      const account = auth.findByEmail('volver@prueba.com')!;
      expect(account).toMatchObject({ status: 'ACTIVA', deactivatedAt: undefined, reactivatedAt: now });
      expect(lastReactivation()).toMatchObject({ actor: 'volver@prueba.com', entityId: account.id, result: AuditResult.EXITOSO });
      expect(lastReactivation()?.detail).not.toMatch(/\b(HU|RF|RN)-\d/);
    });

    it('después puede iniciar sesión normalmente', async () => {
      await deactivated('normal@prueba.com');
      auth.reactivate({ reactivationToken: (await offer('normal@prueba.com')).reactivationToken });

      await expect(controller.login({ email: 'normal@prueba.com', password })).resolves.toMatchObject({ message: 'Inicio de sesión exitoso' });
    });

    it('las publicaciones del anfitrión siguen PAUSADAS hasta que él las reactive', async () => {
      let casa = '';
      await deactivated('anfitrion.vuelve@prueba.com', Role.ANFITRION, (session) => {
        casa = listings.create(
          {
            title: 'Casa en Jardín',
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
          session,
        ).id;
        listings.getListing(casa)!.status = ListingStatus.ACTIVA;
      });
      expect(listings.getListing(casa)?.status).toBe(ListingStatus.PAUSADA);

      const result = auth.reactivate({ reactivationToken: (await offer('anfitrion.vuelve@prueba.com')).reactivationToken });

      expect(listings.getListing(casa)?.status).toBe(ListingStatus.PAUSADA);
      const session = auth.getSession(result.token) as ActiveSession;
      expect(listings.reactivateListing(casa, session).status).toBe(ListingStatus.ACTIVA);
    });

    it('el token es de un solo uso', async () => {
      await deactivated('un.uso@prueba.com');
      const { reactivationToken } = await offer('un.uso@prueba.com');
      auth.reactivate({ reactivationToken });

      expect(() => auth.reactivate({ reactivationToken })).toThrow(BadRequestException);
      expect(lastReactivation()).toMatchObject({ result: AuditResult.FALLIDO });
    });

    it('al reactivar se invalidan las demás ofertas pendientes de la misma cuenta', async () => {
      await deactivated('dos.ofertas@prueba.com');
      const first = (await offer('dos.ofertas@prueba.com')).reactivationToken;
      const second = (await offer('dos.ofertas@prueba.com')).reactivationToken;

      auth.reactivate({ reactivationToken: second });

      expect(() => auth.reactivate({ reactivationToken: first })).toThrow(BadRequestException);
    });

    it('un token vencido o inventado se rechaza y la cuenta sigue desactivada', async () => {
      await deactivated('vencido@prueba.com');
      const { reactivationToken } = await offer('vencido@prueba.com');
      const later = new Date(Date.now() + 11 * 60 * 1000);

      expect(() => auth.reactivate({ reactivationToken }, later)).toThrow('La solicitud de reactivación venció o no es válida');
      expect(() => auth.reactivate({ reactivationToken: 'inventado' })).toThrow(BadRequestException);
      expect(auth.findByEmail('vencido@prueba.com')?.status).toBe('DESACTIVADA');
    });

    it('el token es obligatorio', async () => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });

      await expect(pipe.transform({}, { type: 'body', metatype: ReactivateAccountDto })).rejects.toThrow(BadRequestException);
    });
  });
});
