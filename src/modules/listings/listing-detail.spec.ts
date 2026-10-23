import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { LISTING_NOT_AVAILABLE, ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService } from '../auth/auth.service';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-026 · Consultar el detalle de una publicación (CA1, CA2, RF-034, RN-006)', () => {
  let controller: ListingsController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService, AuthService],
    }).compile();

    controller = module.get(ListingsController);
    authService = module.get(AuthService);
    authService.onModuleInit();
  });

  const loginAs = async (email: string, role: Role.HUESPED | Role.ANFITRION) => {
    await authService.register({ name: 'Usuario Prueba', email, password: 'Password123', role });
    const { token } = await authService.login({ email, password: 'Password123' });
    return { token: `Bearer ${token}`, session: authService.getSession(token) as ActiveSession };
  };

  const notAvailable = new NotFoundException(LISTING_NOT_AVAILABLE);

  describe('CA1 · Veo el detalle completo de una publicación ACTIVA', () => {
    it('incluye todos los datos para comparar y decidir', () => {
      const detail = controller.findOne('demo-bogota-chapinero');

      expect(detail).toEqual({
        id: 'demo-bogota-chapinero',
        title: 'Apartamento en Chapinero Alto',
        description: expect.any(String),
        location: {
          address: 'Carrera 4 # 57-20, Chapinero Alto',
          city: 'Bogotá',
          department: 'Cundinamarca',
          country: 'Colombia',
          text: 'Carrera 4 # 57-20, Chapinero Alto, Bogotá, Cundinamarca, Colombia',
        },
        propertyType: 'APARTAMENTO',
        propertyTypeLabel: 'Apartamento',
        maxGuests: 2,
        bedrooms: 1,
        bathrooms: 1,
        pricePerNight: 280000,
        amenities: ['WIFI', 'WORKSPACE', 'KITCHEN'],
        rules: ['No fumar', 'No se admiten fiestas'],
        images: [expect.stringContaining('https://')],
        cancellationPolicy: {
          code: 'FLEXIBLE',
          name: 'Flexible',
          description: expect.stringContaining('48 horas'),
          rules: [
            { minHoursBeforeCheckIn: 48, refundPercentage: 100 },
            { minHoursBeforeCheckIn: 0, refundPercentage: 50 },
          ],
        },
        additionalServices: [
          { name: 'Traslado desde el aeropuerto', cost: 80000 },
          { name: 'Desayuno para dos', cost: 45000 },
        ],
        averageRating: 4.9,
        reviewCount: 18,
        hostName: 'Valentina Rojas',
        status: ListingStatus.ACTIVA,
      });
    });

    it('sin política elegida asigna la Flexible y sin servicios adicionales devuelve una lista vacía', () => {
      const detail = controller.findOne('demo-bogota-chico');

      expect(detail.cancellationPolicy.code).toBe('FLEXIBLE');
      expect(detail.additionalServices).toEqual([]);
      expect(detail.averageRating).toBe(0);
    });

    it('no expone datos internos de la publicación', () => {
      const detail = controller.findOne('demo-bogota-chapinero');

      for (const field of ['hostId', 'returnReason', 'blockReason', 'missingFields', 'requestedAt']) {
        expect(detail).not.toHaveProperty(field);
      }
    });
  });

  describe('CA2 · Una publicación no ACTIVA no está disponible si no tengo reservas en ella', () => {
    it.each(['demo-bogota-pausada', 'pending-listing-1', 'no-existe'])(
      'el visitante recibe "no está disponible" para %s',
      (id) => {
        expect(() => controller.findOne(id)).toThrow(notAvailable);
      },
    );

    it('otro huésped sin reservas y otro anfitrión tampoco la ven', async () => {
      const guest = await loginAs('huesped26@stayhub.com', Role.HUESPED);
      const otherHost = await loginAs('otro26@stayhub.com', Role.ANFITRION);

      expect(() => controller.findOne('demo-bogota-pausada', guest.token)).toThrow(notAvailable);
      expect(() => controller.findOne('demo-bogota-pausada', otherHost.token)).toThrow(notAvailable);
      expect(() => controller.findOne('demo-bogota-pausada', 'Bearer token-falso')).toThrow(notAvailable);
    });

    it('el huésped con una reserva en ella sí ve el detalle (AMB-39)', async () => {
      const guest = await loginAs('conreserva26@stayhub.com', Role.HUESPED);
      controller.blockReservedPeriod('demo-bogota-pausada', { checkIn: '2026-12-02', checkOut: '2026-12-04' }, guest.session);

      expect(controller.findOne('demo-bogota-pausada', guest.token).status).toBe(ListingStatus.PAUSADA);
    });

    it('una reserva registrada por el anfitrión no le da acceso a ningún huésped', async () => {
      const owner = await loginAs('anfitrion26@stayhub.com', Role.ANFITRION);
      const guest = await loginAs('sinreserva26@stayhub.com', Role.HUESPED);
      controller.blockReservedPeriod('demo-bogota-pausada', { checkIn: '2026-12-05', checkOut: '2026-12-07' }, owner.session);

      expect(() => controller.findOne('demo-bogota-pausada', guest.token)).toThrow(notAvailable);
    });

    it('el anfitrión dueño ve su borrador y el administrador ve cualquier publicación', async () => {
      const owner = await loginAs('dueno26@stayhub.com', Role.ANFITRION);
      const draft = controller.create({ title: 'Borrador del anfitrión' }, owner.session);
      const { token } = await authService.login({ email: 'admin@inversioneslr.com', password: 'AdminLr2026!' });

      expect(controller.findOne(draft.id, owner.token).status).toBe(ListingStatus.BORRADOR);
      expect(() => controller.findOne(draft.id)).toThrow(notAvailable);
      expect(controller.findOne('demo-bogota-pausada', `Bearer ${token}`).status).toBe(ListingStatus.PAUSADA);
    });
  });
});
