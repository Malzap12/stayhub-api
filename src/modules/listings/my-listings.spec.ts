import { Test, TestingModule } from '@nestjs/testing';
import { ListingsController } from './listings.controller';
import { ListingsService, toMyListing } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-012 · Consultar mis publicaciones (CA1, CA2, RF-016, RN-005)', () => {
  let controller: ListingsController;

  const host: ActiveSession = {
    token: 'jwt-host',
    userId: 'user-host-12',
    email: 'anfitrion@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };
  const ADMIN_EMAIL = 'admin@inversioneslr.com';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();

    controller = module.get(ListingsController);
  });

  /** Simula que el anfitrión envió la publicación a revisión (flujo fuera del alcance de esta HU). */
  const sendToReview = (listing: { status?: ListingStatus }) => {
    listing.status = ListingStatus.PENDIENTE_REVISION;
  };

  describe('CA1 · Veo cada publicación con título, ciudad, precio y estado', () => {
    it('lista solo mis publicaciones con los datos del resumen, las más recientes primero', () => {
      const first = controller.create(
        { title: 'Cabaña del Bosque', city: 'Guatapé', pricePerNight: 320000 },
        host,
      );
      first.createdAt = new Date('2026-10-18T10:00:00.000Z');
      const second = controller.create({ title: 'Apartamento en Laureles' }, host);
      controller.create({ title: 'Casa de otro anfitrión', city: 'Cali' }, { ...host, userId: 'otro-host' });

      const mine = controller.findMine(host);

      expect(mine.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(mine[1]).toEqual({
        id: first.id,
        title: 'Cabaña del Bosque',
        city: 'Guatapé',
        pricePerNight: 320000,
        status: ListingStatus.BORRADOR,
        statusLabel: 'Borrador',
        isComplete: false,
        missingFields: expect.any(Array),
        createdAt: first.createdAt,
      });
    });

    it('un borrador sin ciudad ni precio se lista igual, con esos datos vacíos', () => {
      controller.create({ title: 'Apartamento en Laureles' }, host);

      const [item] = controller.findMine(host);
      expect(item.city).toBeUndefined();
      expect(item.pricePerNight).toBeUndefined();
      expect(item.adminReason).toBeUndefined();
    });

    it('RN-005: no expone datos internos ni de otros anfitriones', () => {
      controller.create({ title: 'Cabaña del Bosque', address: 'Vereda El Roble' }, host);

      const [item] = controller.findMine(host);
      expect(item).not.toHaveProperty('hostId');
      expect(item).not.toHaveProperty('address');
      expect(controller.findMine({ ...host, userId: 'sin-publicaciones' })).toEqual([]);
    });

    it('muestra el nombre de cada estado', () => {
      const statuses = Object.values(ListingStatus);
      const labels = statuses.map(
        (status) =>
          toMyListing({
            id: 'x',
            title: 'x',
            status,
            isComplete: true,
            missingFields: [],
            createdAt: new Date(),
          } as never).statusLabel,
      );
      expect(labels).toEqual(['Borrador', 'En revisión', 'Activa', 'Pausada', 'Bloqueada']);
    });
  });

  describe('CA2 · Veo el motivo cuando la publicación fue devuelta o bloqueada', () => {
    it('muestra el motivo de devolución indicado por el administrador', async () => {
      const listing = controller.create({ title: 'Cabaña del Bosque', city: 'Guatapé' }, host);
      sendToReview(listing);
      await controller.returnListing(
        listing.id,
        { reason: 'Las fotografías están oscuras; agrega imágenes del exterior.' },
        { ...host, email: ADMIN_EMAIL, role: Role.ADMINISTRADOR },
      );

      const [item] = controller.findMine(host);
      expect(item).toMatchObject({
        status: ListingStatus.BORRADOR,
        statusLabel: 'Borrador',
        adminReasonType: 'DEVUELTA',
        adminReason: 'Las fotografías están oscuras; agrega imágenes del exterior.',
      });
    });

    it('muestra el motivo de bloqueo indicado por el administrador', () => {
      const listing = controller.create({ title: 'Cabaña del Bosque' }, host);
      listing.status = ListingStatus.BLOQUEADA;
      listing.blockReason = 'Fotografías que no corresponden al inmueble';

      const [item] = controller.findMine(host);
      expect(item).toMatchObject({
        status: ListingStatus.BLOQUEADA,
        statusLabel: 'Bloqueada',
        adminReasonType: 'BLOQUEADA',
        adminReason: 'Fotografías que no corresponden al inmueble',
      });
    });

    it('no muestra motivo cuando la publicación fue aprobada después de una devolución', async () => {
      const listing = controller.create({ title: 'Cabaña del Bosque' }, host);
      const admin = { ...host, email: ADMIN_EMAIL, role: Role.ADMINISTRADOR };
      sendToReview(listing);
      await controller.returnListing(listing.id, { reason: 'Falta la dirección' }, admin);
      sendToReview(listing);
      await controller.approveListing(listing.id, admin);

      const [item] = controller.findMine(host);
      expect(item.status).toBe(ListingStatus.ACTIVA);
      expect(item.adminReasonType).toBeUndefined();
      expect(item.adminReason).toBeUndefined();
    });
  });
});
