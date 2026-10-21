import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { AuditService } from '../audit/audit.service';
import { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-019 · Registrar periodos disponibles (CA1, CA2, CA3, RF-025)', () => {
  let controller: ListingsController;
  let auditService: AuditService;
  let listingId: string;

  const host: ActiveSession = {
    token: 'jwt-host',
    userId: 'user-host-19',
    email: 'anfitrion19@stayhub.com',
    role: Role.ANFITRION,
    expiresAt: Date.now() + 60_000,
  };

  /** Captura el error lanzado por una promesa para revisar su respuesta. */
  const rejectionOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (caught) {
      return caught as BadRequestException;
    }
    throw new Error('Se esperaba que el registro del periodo fuera rechazado');
  };

  const lastAuditEvent = () =>
    auditService
      .findAll({ action: AuditAction.AVAILABILITY_PERIOD_CREATE })
      .filter((event) => event.entityId === listingId)
      .at(-1)!;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [ListingsService, AuditService],
    }).compile();

    controller = module.get(ListingsController);
    auditService = module.get(AuditService);
    listingId = controller.create({ title: 'Cabaña del Bosque', city: 'Guatapé' }, host).id;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('CA1 · Con fecha de fin posterior a la de inicio el periodo queda disponible', () => {
    it('registra el periodo y lo marca disponible para reservas', async () => {
      const created = await controller.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-03-01', endDate: '2027-03-15' },
        host,
      );

      expect(created).toMatchObject({
        listingId,
        startDate: '2027-03-01',
        endDate: '2027-03-15',
        availableForBooking: true,
      });
      expect(controller.getAvailabilityPeriods(listingId, host)).toEqual([created]);
    });

    it('la consulta de disponibilidad acepta fechas dentro del periodo y rechaza las de fuera', async () => {
      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-03-01', endDate: '2027-03-15' }, host);

      const inRange = controller.getAvailability(listingId, { startDate: '2027-03-05', endDate: '2027-03-10' });
      const outOfRange = controller.getAvailability(listingId, { startDate: '2027-04-01', endDate: '2027-04-05' });

      expect(inRange.isAvailable).toBe(true);
      expect(outOfRange.isAvailable).toBe(false);
    });

    it('lista los periodos ordenados por fecha de inicio', async () => {
      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-08-01', endDate: '2027-08-10' }, host);
      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-02-01', endDate: '2027-02-10' }, host);

      const periods = controller.getAvailabilityPeriods(listingId, host);
      expect(periods.map((period) => period.startDate)).toEqual(['2027-02-01', '2027-08-01']);
    });

    it('acepta un periodo que empieza hoy en Colombia aunque en UTC ya sea mañana', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2027-01-11T03:00:00.000Z')); // 10 de enero, 10:00 p. m. en Bogotá

      const created = await controller.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-01-10', endDate: '2027-01-12' },
        host,
      );

      expect(created.startDate).toBe('2027-01-10');
    });
  });

  describe('CA2 · Rechaza periodos que terminan antes de empezar o comienzan en el pasado', () => {
    it('rechaza una fecha de fin anterior o igual a la de inicio', async () => {
      await expect(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2027-05-10', endDate: '2027-05-05' }, host),
      ).rejects.toThrow('La fecha de fin debe ser posterior a la fecha de inicio del periodo.');
      await expect(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2027-05-10', endDate: '2027-05-10' }, host),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un periodo que comienza en el pasado', async () => {
      await expect(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2020-01-01', endDate: '2020-01-10' }, host),
      ).rejects.toThrow('La fecha de inicio del periodo no puede estar en el pasado.');
    });

    it('rechaza fechas vacías, con formato inválido o que no existen en el calendario', async () => {
      for (const startDate of ['', 'fecha-invalida', '2027-02-30']) {
        await expect(
          controller.registerAvailabilityPeriod(listingId, { startDate, endDate: '2027-05-10' }, host),
        ).rejects.toThrow(BadRequestException);
      }
      expect(controller.getAvailabilityPeriods(listingId, host)).toEqual([]);
    });
  });

  describe('CA3 · Rechaza periodos superpuestos e indica el periodo existente', () => {
    it('incluye el periodo existente en el mensaje y en conflictingPeriod', async () => {
      const existing = await controller.registerAvailabilityPeriod(
        listingId,
        { startDate: '2027-06-10', endDate: '2027-06-20' },
        host,
      );

      const error = await rejectionOf(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2027-06-15', endDate: '2027-06-25' }, host),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({
        message: 'El periodo solicitado se superpone con el periodo existente del 2027-06-10 al 2027-06-20.',
        conflictingPeriod: { id: existing.id, startDate: '2027-06-10', endDate: '2027-06-20' },
      });
      expect(controller.getAvailabilityPeriods(listingId, host)).toHaveLength(1);
    });

    it('también rechaza un periodo que contiene por completo al existente', async () => {
      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-06-10', endDate: '2027-06-20' }, host);

      await expect(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2027-06-01', endDate: '2027-06-30' }, host),
      ).rejects.toThrow(/2027-06-10 al 2027-06-20/);
    });

    it('permite periodos que no se cruzan y periodos iguales en otro alojamiento', async () => {
      const otherListingId = controller.create({ title: 'Loft en Laureles', city: 'Medellín' }, host).id;
      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-06-10', endDate: '2027-06-20' }, host);

      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-06-21', endDate: '2027-06-30' }, host);
      await controller.registerAvailabilityPeriod(otherListingId, { startDate: '2027-06-10', endDate: '2027-06-20' }, host);

      expect(controller.getAvailabilityPeriods(listingId, host)).toHaveLength(2);
      expect(controller.getAvailabilityPeriods(otherListingId, host)).toHaveLength(1);
    });
  });

  describe('Dueño del alojamiento y auditoría', () => {
    it('un anfitrión no puede registrar ni ver periodos de un alojamiento ajeno', async () => {
      const otherHost = { ...host, userId: 'otro-anfitrion', email: 'otro@stayhub.com' };

      await expect(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2027-03-01', endDate: '2027-03-15' }, otherHost),
      ).rejects.toThrow(NotFoundException);
      expect(() => controller.getAvailabilityPeriods(listingId, otherHost)).toThrow(NotFoundException);
    });

    it('responde 404 si el alojamiento no existe', async () => {
      await expect(
        controller.registerAvailabilityPeriod('no-existe', { startDate: '2027-03-01', endDate: '2027-03-15' }, host),
      ).rejects.toThrow(NotFoundException);
    });

    it('audita el periodo registrado con el anfitrión como actor', async () => {
      await controller.registerAvailabilityPeriod(listingId, { startDate: '2027-03-01', endDate: '2027-03-15' }, host);

      expect(lastAuditEvent()).toMatchObject({
        actor: host.email,
        result: AuditResult.EXITOSO,
        detail: 'Periodo disponible registrado: 2027-03-01 al 2027-03-15',
      });
    });

    it('audita también los periodos rechazados', async () => {
      await expect(
        controller.registerAvailabilityPeriod(listingId, { startDate: '2020-01-01', endDate: '2020-01-10' }, host),
      ).rejects.toThrow(BadRequestException);

      expect(lastAuditEvent()).toMatchObject({
        result: AuditResult.FALLIDO,
        detail: 'Periodo rechazado: La fecha de inicio del periodo no puede estar en el pasado.',
      });
    });
  });
});
