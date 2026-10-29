import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { CANCELLATION_POLICIES, getCancellationPoliciesCatalog } from './cancellation-policies';

describe('HU-039 y HU-017 · Catálogo y asociación de política de cancelación (RF-021, RF-058, RN-004, RN-016)', () => {
  let controller: ListingsController;
  let authService: AuthService;
  let host: ActiveSession;
  let hostToken: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService, AuthService],
    }).compile();

    controller = module.get(ListingsController);
    authService = module.get(AuthService);
    authService.onModuleInit();

    const email = 'anfitrion.hu017@stayhub.com';
    await authService.register({ name: 'Anfitrión HU017', email, password: 'Password123', role: Role.ANFITRION } as never);
    const loginRes = await authService.login({ email, password: 'Password123' } as never);
    hostToken = `Bearer ${loginRes.token}`;
    host = authService.getSession(loginRes.token)!;
  });

  describe('HU-039 · Disponer de la política de cancelación Flexible (CA1, CA2)', () => {
    it('CA1: incluye la política Flexible con sus reglas de 100 % (>= 48 h) y 50 % (< 48 h)', () => {
      const catalog = controller.getCancellationPolicies();

      expect(catalog).toEqual(getCancellationPoliciesCatalog());
      expect(catalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'FLEXIBLE',
            name: 'Flexible',
            rules: [
              { minHoursBeforeCheckIn: 48, refundPercentage: 100 },
              { minHoursBeforeCheckIn: 0, refundPercentage: 50 },
            ],
          }),
        ]),
      );
    });

    it('CA2: el detalle de la publicación muestra la explicación de la regla de 48 horas y 50 % junto con un ejemplo de fechas', () => {
      const detail = controller.findOne('demo-bogota-chapinero');

      expect(detail.cancellationPolicy.code).toBe('FLEXIBLE');
      expect(detail.cancellationPolicy.name).toBe('Flexible');
      expect(detail.cancellationPolicy.description).toContain('100 %');
      expect(detail.cancellationPolicy.description).toContain('48 horas');
      expect(detail.cancellationPolicy.description).toContain('50 %');
      expect(detail.cancellationPolicy.description).toMatch(/Por ejemplo.*15 de noviembre.*13 de noviembre/);
    });
  });

  describe('HU-017 · Asociar una política de cancelación (CA1, CA2 · RF-021, RN-004, RN-016)', () => {
    it('CA1: asocia una política del catálogo a la publicación, queda registrada y se muestra en el detalle', () => {
      const draft = controller.create({ title: 'Cabaña en Guatapé' }, host);
      expect(draft.cancellationPolicy).toBeUndefined();

      const policy = controller.updateCancellationPolicy(draft.id, { code: 'FLEXIBLE' }, host);
      expect(policy).toEqual(CANCELLATION_POLICIES.FLEXIBLE);

      const detail = controller.findOne(draft.id, hostToken);
      expect(detail.cancellationPolicy.code).toBe('FLEXIBLE');
      expect(detail.cancellationPolicy.name).toBe('Flexible');
      expect(detail.cancellationPolicy.rules).toEqual(CANCELLATION_POLICIES.FLEXIBLE.rules);

      const mine = controller.findMine(host);
      const myListing = mine.find((item) => item.id === draft.id);
      expect(myListing?.cancellationPolicy).toBe('FLEXIBLE');
    });

    it('CA1: rechaza asociar una política inexistente o sobre una publicación ajena', async () => {
      const draft = controller.create({ title: 'Publicación propia' }, host);
      await authService.register({ name: 'Otro Anfitrión', email: 'otro@stayhub.com', password: 'Password123', role: Role.ANFITRION } as never);
      const otherLogin = await authService.login({ email: 'otro@stayhub.com', password: 'Password123' } as never);
      const otherHost = authService.getSession(otherLogin.token)!;

      expect(() =>
        controller.updateCancellationPolicy(draft.id, { code: 'INEXISTENTE' as 'FLEXIBLE' }, host),
      ).toThrow(BadRequestException);

      expect(() =>
        controller.updateCancellationPolicy(draft.id, { code: 'FLEXIBLE' }, otherHost),
      ).toThrow(NotFoundException);
    });

    it('CA2: dado que no elegí una política, al solicitar la activación el sistema asigna la política Flexible por defecto', () => {
      const completeDraft = controller.create(
        {
          title: 'Casa Campestre sin política',
          description: 'Espaciosa y campestre con todas las comodidades.',
          city: 'Manizales',
          department: 'Caldas',
          address: 'Vereda La Linda',
          propertyType: PropertyType.CASA,
          maxGuests: 6,
          pricePerNight: 400000,
          amenities: ['WIFI', 'PARQUEADERO'],
          rules: ['No fumar dentro'],
          images: ['https://storage.stayhub.com/casa-1.jpg'],
        },
        host,
      );
      expect(completeDraft.cancellationPolicy).toBeUndefined();

      const activated = controller.requestActivation(completeDraft.id, host);
      expect(activated.status).toBe(ListingStatus.PENDIENTE_REVISION);
      expect(activated.cancellationPolicy).toBe('FLEXIBLE');

      const detail = controller.findOne(completeDraft.id, hostToken);
      expect(detail.cancellationPolicy.code).toBe('FLEXIBLE');
    });
  });
});
