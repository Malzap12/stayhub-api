import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { AuditService } from '../audit/audit.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { createAppValidationPipe } from '../../common/pipes/app-validation.pipe';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditAction } from '../../common/enums/audit.enum';

describe('HU-010 · Crear una publicación en borrador (CA1, CA2, CA3, CA4, RF-013, RF-014)', () => {
  let controller: ListingsController;
  let auditService: AuditService;

  const host: ActiveSession = {
    token: 'jwt-host',
    userId: 'user-host-1',
    email: 'anfitriona@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const fullDraft: CreateListingDto = {
    title: 'Cabaña del Bosque',
    description: 'Cabaña de madera con chimenea y vista al embalse.',
    city: 'Guatapé',
    department: 'Antioquia',
    address: 'Vereda El Roble · a 2 km del parque principal',
    propertyType: PropertyType.CABANA,
    maxGuests: 4,
    pricePerNight: 320000,
    amenities: ['WIFI', 'CHIMENEA'],
    rules: ['No fumar'],
    images: ['https://storage.stayhub.com/cabana-1.jpg'],
  };

  const validateBody = async (body: Record<string, unknown>) => {
    try {
      await createAppValidationPipe().transform(body, {
        type: 'body',
        metatype: CreateListingDto,
      });
      return undefined;
    } catch (error) {
      return (error as BadRequestException).getResponse() as {
        message: string[];
        fieldErrors: Record<string, string[]>;
      };
    }
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();

    controller = module.get(ListingsController);
    auditService = module.get(AuditService);
  });

  describe('HU-050 · El administrador ve el nombre del anfitrión', () => {
    it('guarda el nombre de la cuenta del anfitrión al crear la publicación', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [ListingsController],
        providers: [ListingsService, AuditService, AuthService],
      }).compile();
      const authService = module.get(AuthService);
      await authService.register({ name: 'Ana Anfitriona', email: 'ana@stayhub.com', password: 'Password123', role: Role.ANFITRION });
      const { token } = await authService.login({ email: 'ana@stayhub.com', password: 'Password123' });
      const session = authService.getSession(token) as ActiveSession;

      const listing = module.get(ListingsController).create(fullDraft, session);

      expect(listing.hostName).toBe('Ana Anfitriona');
    });

    it('sin cuenta conocida no inventa un nombre', () => {
      expect(controller.create(fullDraft, host).hostName).toBeUndefined();
    });
  });

  describe('CA1 · Publicación en BORRADOR asociada al anfitrión', () => {
    it('crea la publicación con toda la información básica, en BORRADOR y completa', async () => {
      const listing = controller.create(fullDraft, host);

      expect(listing).toMatchObject({
        ...fullDraft,
        country: 'Colombia',
        hostId: host.userId,
        status: ListingStatus.BORRADOR,
        isComplete: true,
        missingFields: [],
      });
      expect(listing.id).toMatch(/^listing-/);
      expect(listing.requestedAt).toBeUndefined();
    });

    it('la publicación aparece entre las del anfitrión y no en la búsqueda pública', async () => {
      const first = controller.create(fullDraft, host);
      const second = controller.create({ title: 'Apartamento en Laureles' }, host);
      controller.create({ title: 'Casa de otro anfitrión' }, { ...host, userId: 'otro-host' });

      const mine = controller.findMine(host);
      expect(mine.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());

      const search = await controller.search({ page: 1, limit: 50 });
      expect(search.data.some((item) => item.id === first.id)).toBe(false);
    });

    it('registra la creación en la auditoría con el anfitrión como actor', async () => {
      const listing = controller.create(fullDraft, host);

      const [event] = auditService.findAll({ action: AuditAction.LISTING_STATUS_CHANGE });
      expect(event).toMatchObject({ actor: host.email, entityId: listing.id });
      expect(event.detail).toBe('Publicación creada en estado BORRADOR');
    });

    it('acepta los campos completos en la validación de entrada', async () => {
      expect(await validateBody({ ...fullDraft })).toBeUndefined();
    });
  });

  describe('CA2 · Capacidad o precio inválidos se rechazan con mensaje por campo', () => {
    it('rechaza capacidad 0', async () => {
      const response = await validateBody({ title: 'Cabaña del Bosque', maxGuests: 0 });
      expect(response?.fieldErrors).toEqual({ maxGuests: ['La capacidad debe ser mayor que 0'] });
    });

    it.each([0, -50000])('rechaza precio por noche %p', async (pricePerNight) => {
      const response = await validateBody({ title: 'Cabaña del Bosque', pricePerNight });
      expect(response?.fieldErrors).toEqual({
        pricePerNight: ['El precio por noche debe ser mayor que 0'],
      });
    });

    it('reporta cada campo inválido por separado y mantiene la lista plana en message', async () => {
      const response = await validateBody({ title: 'Cabaña del Bosque', maxGuests: 0, pricePerNight: 0 });
      expect(Object.keys(response!.fieldErrors).sort()).toEqual(['maxGuests', 'pricePerNight']);
      expect(response!.message).toHaveLength(2);
    });
  });

  describe('CA3 · Solo el ANFITRIÓN puede crear publicaciones (RN-001, RN-002)', () => {
    const contextFor = (role: Role) =>
      ({
        getHandler: () => ListingsController.prototype.create,
        getClass: () => ListingsController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: `Bearer jwt-${role}` } }),
        }),
      }) as unknown as ExecutionContext;

    it('el guard de roles responde 403 al HUÉSPED y al ADMINISTRADOR y permite al ANFITRIÓN', () => {
      const authService = {
        authorize: (_header: string, roles: Role[]) => {
          const role = [Role.HUESPED, Role.ADMINISTRADOR].find((candidate) => _header.endsWith(candidate)) ?? Role.ANFITRION;
          if (!roles.includes(role)) {
            throw new ForbiddenException();
          }
          return { ...host, role };
        },
      } as unknown as AuthService;
      const guard = new RolesGuard(new Reflector(), authService);

      expect(() => guard.canActivate(contextFor(Role.HUESPED))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(contextFor(Role.ADMINISTRADOR))).toThrow(ForbiddenException);
      expect(guard.canActivate(contextFor(Role.ANFITRION))).toBe(true);
    });
  });

  describe('CA4 · Solo con título queda en BORRADOR marcada como incompleta', () => {
    it('acepta solo el título y lista los campos pendientes', async () => {
      expect(await validateBody({ title: 'Apartamento en Laureles' })).toBeUndefined();

      const listing = controller.create({ title: '  Apartamento en Laureles  ' }, host);

      expect(listing).toMatchObject({
        title: 'Apartamento en Laureles',
        status: ListingStatus.BORRADOR,
        isComplete: false,
        amenities: [],
        rules: [],
        images: [],
      });
      expect(listing.missingFields).toEqual([
        'description',
        'city',
        'department',
        'address',
        'propertyType',
        'maxGuests',
        'pricePerNight',
        'amenities',
        'rules',
        'images',
      ]);

      const [event] = auditService.findAll({ action: AuditAction.LISTING_STATUS_CHANGE });
      expect(event.detail).toBe('Publicación creada en estado BORRADOR (incompleta)');
    });

    it('trata como faltantes los textos vacíos y las listas sin elementos útiles', async () => {
      const listing = controller.create(
        { ...fullDraft, description: '   ', images: ['  '] },
        host,
      );
      expect(listing.isComplete).toBe(false);
      expect(listing.missingFields).toEqual(['description', 'images']);
    });

    it('rechaza guardar sin título', async () => {
      const response = await validateBody({ city: 'Medellín' });
      expect(response?.fieldErrors.title).toContain('El título es obligatorio');
    });
  });
});
