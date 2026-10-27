import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { CANCELLATION_POLICIES, getCancellationPoliciesCatalog } from './cancellation-policies';

describe('HU-039 · Disponer de la política de cancelación Flexible (CA1, CA2, RF-058, RN-016)', () => {
  let controller: ListingsController;
  let authService: AuthService;

  const host: ActiveSession = {
    token: 'jwt-host-hu039',
    userId: 'host-hu039',
    email: 'anfitrion.hu039@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService, AuthService],
    }).compile();

    controller = module.get(ListingsController);
    authService = module.get(AuthService);
    authService.onModuleInit();
  });

  describe('CA1 · Catálogo de políticas con la política Flexible (100 % hasta 48 h antes y 50 % después)', () => {
    it('incluye la política Flexible con sus reglas de 100 % (>= 48 h) y 50 % (< 48 h)', () => {
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

    it('permite asociar la política Flexible al crear o actualizar una publicación del anfitrión', () => {
      const created = controller.create(
        { title: 'Cabaña con política Flexible', cancellationPolicy: 'FLEXIBLE' },
        host,
      );
      expect(created.cancellationPolicy).toBe('FLEXIBLE');

      const draft = controller.create({ title: 'Otra publicación del anfitrión' }, host);
      const policy = controller.updateCancellationPolicy(draft.id, { code: 'FLEXIBLE' }, host);

      expect(policy).toEqual(CANCELLATION_POLICIES.FLEXIBLE);
    });

    it('rechaza asociar una política inexistente o sobre una publicación ajena', () => {
      const draft = controller.create({ title: 'Publicación propia' }, host);
      const otherHost: ActiveSession = { ...host, userId: 'otro-host-hu039', email: 'otro@stayhub.com' };

      expect(() =>
        controller.updateCancellationPolicy(draft.id, { code: 'INEXISTENTE' as 'FLEXIBLE' }, host),
      ).toThrow(BadRequestException);

      expect(() =>
        controller.updateCancellationPolicy(draft.id, { code: 'FLEXIBLE' }, otherHost),
      ).toThrow(NotFoundException);
    });
  });

  describe('CA2 · En el detalle de una publicación el texto de la política explica la regla con un ejemplo de fechas', () => {
    it('el detalle de la publicación muestra la explicación de la regla de 48 horas y 50 % junto con un ejemplo de fechas', () => {
      const detail = controller.findOne('demo-bogota-chapinero');

      expect(detail.cancellationPolicy.code).toBe('FLEXIBLE');
      expect(detail.cancellationPolicy.name).toBe('Flexible');
      expect(detail.cancellationPolicy.description).toContain('100 %');
      expect(detail.cancellationPolicy.description).toContain('48 horas');
      expect(detail.cancellationPolicy.description).toContain('50 %');
      expect(detail.cancellationPolicy.description).toMatch(/Por ejemplo.*15 de noviembre.*13 de noviembre/);
    });
  });
});
