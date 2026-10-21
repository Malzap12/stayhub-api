import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-013 · Solicitar la activación de mi publicación (CA1, CA2, CA3, RF-017)', () => {
  let controller: ListingsController;
  let auditService: AuditService;

  const host: ActiveSession = {
    token: 'jwt-host',
    userId: 'user-host-13',
    email: 'anfitrion13@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  const completeDraft: CreateListingDto = {
    title: 'Cabaña del Bosque',
    description: 'Cabaña de madera con chimenea y vista al embalse.',
    city: 'Guatapé',
    department: 'Antioquia',
    address: 'Vereda El Roble',
    propertyType: PropertyType.CABANA,
    maxGuests: 4,
    pricePerNight: 320000,
    amenities: ['WIFI'],
    rules: ['No fumar'],
    images: ['https://storage.stayhub.com/cabana-1.jpg'],
  };

  /** Último evento de cambio de estado registrado para la publicación. */
  const lastAuditEvent = (listingId: string) =>
    auditService
      .findAll({ action: AuditAction.LISTING_STATUS_CHANGE })
      .filter((event) => event.entityId === listingId)
      .at(-1)!;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();

    controller = module.get(ListingsController);
    auditService = module.get(AuditService);
  });

  describe('CA1 · Con los 9 campos mínimos y una imagen pasa a PENDIENTE_REVISION', () => {
    it('cambia el estado y registra la fecha de solicitud', () => {
      const listing = controller.create(completeDraft, host);
      const before = Date.now();

      const result = controller.requestActivation(listing.id, host);

      expect(result).toMatchObject({
        id: listing.id,
        status: ListingStatus.PENDIENTE_REVISION,
        statusLabel: 'En revisión',
        isComplete: true,
        missingFields: [],
      });
      expect(listing.requestedAt?.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('la publicación queda en la cola de revisión del administrador', async () => {
      const listing = controller.create(completeDraft, host);
      controller.requestActivation(listing.id, host);

      const queue = await controller.findPendingQueue();
      expect(queue.map((item) => item.id)).toContain(listing.id);
    });

    it('una publicación devuelta y corregida puede volver a solicitarse sin el motivo anterior', async () => {
      const listing = controller.create(completeDraft, host);
      const admin = { ...host, email: 'admin@inversioneslr.com', role: Role.ADMINISTRADOR };
      controller.requestActivation(listing.id, host);
      await controller.returnListing(listing.id, { reason: 'Mejora las fotografías' }, admin);

      const result = controller.requestActivation(listing.id, host);

      expect(result.status).toBe(ListingStatus.PENDIENTE_REVISION);
      expect(result.adminReason).toBeUndefined();
    });
  });

  describe('CA2 · Si falta información la rechaza y lista los campos faltantes', () => {
    it('rechaza un borrador incompleto con los campos y sus nombres', () => {
      const listing = controller.create({ title: 'Apartamento en Laureles', city: 'Medellín' }, host);

      let error: BadRequestException | undefined;
      try {
        controller.requestActivation(listing.id, host);
      } catch (caught) {
        error = caught as BadRequestException;
      }

      expect(error).toBeInstanceOf(BadRequestException);
      const body = error!.getResponse() as { message: string; missingFields: string[]; missingFieldLabels: string[] };
      expect(body.missingFields).toEqual([
        'description',
        'department',
        'address',
        'propertyType',
        'maxGuests',
        'pricePerNight',
        'amenities',
        'rules',
        'images',
      ]);
      expect(body.missingFieldLabels).toContain('al menos una imagen');
      expect(body.message).toContain('Falta: descripción');
      expect(controller.findMine(host)[0].status).toBe(ListingStatus.BORRADOR);
    });

    it('exige al menos una imagen aunque estén los 9 campos', () => {
      const listing = controller.create({ ...completeDraft, images: [] }, host);

      expect(() => controller.requestActivation(listing.id, host)).toThrow(BadRequestException);
      try {
        controller.requestActivation(listing.id, host);
      } catch (caught) {
        expect((caught as BadRequestException).getResponse()).toMatchObject({ missingFields: ['images'] });
      }
    });
  });

  describe('CA3 · Veo el estado PENDIENTE_REVISION y el cambio queda en la auditoría', () => {
    it('Mis publicaciones muestra el nuevo estado', () => {
      const listing = controller.create(completeDraft, host);
      controller.requestActivation(listing.id, host);

      expect(controller.findMine(host)[0]).toMatchObject({
        id: listing.id,
        status: ListingStatus.PENDIENTE_REVISION,
      });
    });

    it('registra la transición BORRADOR -> PENDIENTE_REVISION con el anfitrión como actor', () => {
      const listing = controller.create(completeDraft, host);
      controller.requestActivation(listing.id, host);

      const event = lastAuditEvent(listing.id);
      expect(event).toMatchObject({
        actor: host.email,
        result: AuditResult.EXITOSO,
        detail: 'BORRADOR -> PENDIENTE_REVISION (solicitud de activación)',
      });
    });

    it('registra también los intentos rechazados (RN-021)', () => {
      const listing = controller.create({ title: 'Apartamento en Laureles' }, host);
      expect(() => controller.requestActivation(listing.id, host)).toThrow(BadRequestException);

      const event = lastAuditEvent(listing.id);
      expect(event.result).toBe(AuditResult.FALLIDO);
      expect(event.detail).toContain('Solicitud de activación rechazada: faltan description');
    });
  });

  describe('Reglas de negocio y transiciones (RN-005, AMB-03)', () => {
    it('RN-005: un anfitrión no puede solicitar la activación de una publicación ajena', () => {
      const listing = controller.create(completeDraft, host);
      const otherHost = { ...host, userId: 'otro-anfitrion', email: 'otro@stayhub.com' };

      expect(() => controller.requestActivation(listing.id, otherHost)).toThrow(NotFoundException);
      expect(controller.findMine(host)[0].status).toBe(ListingStatus.BORRADOR);
    });

    it('responde 404 si la publicación no existe', () => {
      expect(() => controller.requestActivation('no-existe', host)).toThrow(NotFoundException);
    });

    it('solo se solicita desde BORRADOR: una publicación ya en revisión no se vuelve a enviar', () => {
      const listing = controller.create(completeDraft, host);
      controller.requestActivation(listing.id, host);

      expect(() => controller.requestActivation(listing.id, host)).toThrow(
        'Solo puedes solicitar la activación de una publicación en BORRADOR (estado actual: En revisión)',
      );
    });
  });
});
