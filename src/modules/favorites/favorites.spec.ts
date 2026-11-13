import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rowsToSource, sourceToRows, TABLE_DEFINITIONS } from '../persistence/state-tables';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

describe('HU-072 · Guardar alojamientos en mis favoritos (EP-18)', () => {
  let controller: FavoritesController;
  let favoritesService: FavoritesService;
  let listingsService: ListingsService;
  let authService: AuthService;

  let guestSession: ActiveSession;
  let guest2Session: ActiveSession;
  let hostSession: ActiveSession;
  let adminSession: ActiveSession;

  let activeListingId1: string;
  let activeListingId2: string;
  let draftListingId: string;

  const makeSession = (userId: string, email: string, _name: string, role: Role): ActiveSession => ({
    token: `tok-${userId}`,
    userId,
    email,
    role,
    expiresAt: Date.now() + 3_600_000,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FavoritesController],
      providers: [
        FavoritesService,
        ListingsService,
        AuthService,
        AuditService,
        NotificationsService,
      ],
    }).compile();

    controller = module.get(FavoritesController);
    favoritesService = module.get(FavoritesService);
    listingsService = module.get(ListingsService);
    authService = module.get(AuthService);

    const g1 = await authService.register({
      name: 'Laura Huésped',
      email: 'laura.fav@stayhub.com',
      password: 'Password1!',
      phone: '310 555 1111',
      role: Role.HUESPED,
    });
    const g2 = await authService.register({
      name: 'Pedro Huésped',
      email: 'pedro.fav@stayhub.com',
      password: 'Password1!',
      phone: '310 555 2222',
      role: Role.HUESPED,
    });
    const h1 = await authService.register({
      name: 'Carlos Anfitrión',
      email: 'carlos.fav@stayhub.com',
      password: 'Password1!',
      phone: '300 444 5555',
      role: Role.ANFITRION,
    });

    guestSession = makeSession(g1.user.id, g1.user.email, g1.user.name, Role.HUESPED);
    guest2Session = makeSession(g2.user.id, g2.user.email, g2.user.name, Role.HUESPED);
    hostSession = makeSession(h1.user.id, h1.user.email, h1.user.name, Role.ANFITRION);
    adminSession = makeSession('admin-1', 'admin@inversioneslr.com', 'Admin', Role.ADMINISTRADOR);

    const createActive = (title: string, city: string, price: number) => {
      const created = listingsService.create(
        {
          title,
          description: 'Espacio acogedor y luminoso.',
          city,
          department: 'Quindío',
          address: 'Km 4 Vía Valle',
          pricePerNight: price,
          maxGuests: 4,
          bedrooms: 2,
          bathrooms: 2,
          images: ['https://example.com/foto1.jpg'],
        },
        hostSession,
      );
      const raw = listingsService.getListing(created.id) as any;
      raw.status = ListingStatus.ACTIVA;
      raw.rating = 4.75;
      return created.id;
    };

    activeListingId1 = createActive('Cabaña El Roble', 'Salento', 320000);
    activeListingId2 = createActive('Apartamento Mirador', 'Armenia', 240000);

    const draft = listingsService.create(
      {
        title: 'Finca Borrador',
        city: 'Filandia',
        department: 'Quindío',
        address: 'Vereda Bambuco',
        pricePerNight: 450000,
        maxGuests: 6,
      },
      hostSession,
    );
    draftListingId = draft.id;
  });

  it('CA1 & CA3: huésped guarda alojamiento ACTIVO, persiste e ignora duplicados de forma idempotente', () => {
    const first = controller.save(activeListingId1, guestSession);
    expect(first.saved).toBe(true);
    expect(first.listingId).toBe(activeListingId1);

    // Segunda solicitud repetida (ej. desde otra pestaña): idempotente, sin error ni duplicado
    const duplicate = controller.save(activeListingId1, guestSession);
    expect(duplicate.saved).toBe(true);
    expect(controller.listIds(guestSession).listingIds).toEqual([activeListingId1]);

    // No permite guardar alojamiento inexistente ni no activo
    expect(() => controller.save('inexistente', guestSession)).toThrow(NotFoundException);
    expect(() => controller.save(draftListingId, guestSession)).toThrow(BadRequestException);
    expect(() => controller.save('   ', guestSession)).toThrow(BadRequestException);
  });

  it('CA2: quitar un alojamiento de favoritos lo elimina de la lista del huésped', () => {
    controller.save(activeListingId1, guestSession);
    expect(controller.listIds(guestSession).listingIds).toEqual([activeListingId1]);

    const removed = controller.remove(activeListingId1, guestSession);
    expect(removed.saved).toBe(false);
    expect(controller.listIds(guestSession).listingIds).toEqual([]);

    // Quitar nuevamente también es idempotente
    expect(controller.remove(activeListingId1, guestSession).saved).toBe(false);
    expect(() => controller.remove('  ', guestSession)).toThrow(BadRequestException);
  });

  it('CA4: lista paginada del más reciente al más antiguo con datos completos para abrir detalle', async () => {
    controller.save(activeListingId1, guestSession);
    await new Promise((r) => setTimeout(r, 15));
    controller.save(activeListingId2, guestSession);

    const page1 = controller.listMine(guestSession, '1', '1');
    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);
    expect(page1.data).toHaveLength(1);
    expect(page1.data[0].listingId).toBe(activeListingId2);
    expect(page1.data[0].title).toBe('Apartamento Mirador');
    expect(page1.data[0].city).toBe('Armenia');
    expect(page1.data[0].pricePerNight).toBe(240000);
    expect(page1.data[0].rating).toBe(4.75);
    expect(page1.data[0].available).toBe(true);
    expect(page1.data[0].imageUrl).toBe('https://example.com/foto1.jpg');

    const page2 = controller.listMine(guestSession, '2', '1');
    expect(page2.data[0].listingId).toBe(activeListingId1);
  });

  it('CA5: si un alojamiento guardado pasa a pausado o bloqueado, se marca no disponible y se puede quitar', () => {
    controller.save(activeListingId1, guestSession);
    const raw = listingsService.getListing(activeListingId1) as any;
    raw.status = ListingStatus.PAUSADA;

    const list = controller.listMine(guestSession);
    expect(list.data[0].status).toBe(ListingStatus.PAUSADA);
    expect(list.data[0].available).toBe(false);

    controller.remove(activeListingId1, guestSession);
    expect(controller.listMine(guestSession).total).toBe(0);
  });

  it('CA6 & RNF-002: anfitriones y administradores reciben 403 y los favoritos están aislados por huésped', () => {
    controller.save(activeListingId1, guestSession);
    expect(controller.listMine(guest2Session).total).toBe(0);
    expect(controller.listIds(guest2Session).listingIds).toEqual([]);

    expect(() => controller.listMine(hostSession)).toThrow(ForbiddenException);
    expect(() => controller.save(activeListingId1, hostSession)).toThrow(ForbiddenException);
    expect(() => controller.listIds(adminSession)).toThrow(ForbiddenException);
    expect(() => controller.remove(activeListingId1, adminSession)).toThrow(ForbiddenException);
  });

  it('Persistencia: sourceToRows, rowsToSource y StatePersistenceService preservan favoritos', () => {
    expect(TABLE_DEFINITIONS.favoritos_huesped).toBeDefined();

    let handlersRef: { dump: () => unknown; restore: (d: unknown) => void } | undefined;
    const persistenceMock = {
      register: (_name: string, handlers: { dump: () => unknown; restore: (d: unknown) => void }) => {
        handlersRef = handlers;
      },
    };
    const standalone = new FavoritesService(listingsService, persistenceMock as any);
    standalone.onModuleInit();
    standalone.saveFavorite(activeListingId1, guestSession);

    const dump = handlersRef?.dump();
    const rows = sourceToRows('favorites', dump);
    expect(rows.favoritos_huesped).toHaveLength(1);

    const restored = rowsToSource('favorites', rows) as { favorites: any[] };
    handlersRef?.restore(null);
    expect(standalone.listMyFavorites(guestSession).total).toBe(0);

    handlersRef?.restore(restored);
    expect(standalone.listMyFavorites(guestSession).total).toBe(1);
    expect(standalone.listMyFavorites(guestSession).data[0].listingId).toBe(activeListingId1);
  });
});
