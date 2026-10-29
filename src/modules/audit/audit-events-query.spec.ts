import { BadRequestException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService, DEFAULT_AUDIT_PAGE_SIZE, MAX_AUDIT_PAGE_SIZE } from './audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

describe('HU-054 · Consultar los eventos de auditoría (CA1, CA2, RF-072, RN-032, RNF-022)', () => {
  let service: AuditService;
  let controller: AuditController;

  /** Registra un evento con la fecha y hora indicadas (UTC). */
  const recordAt = (
    iso: string,
    overrides: Partial<{ actor: string; action: AuditAction; entity: string; result: AuditResult }> = {},
  ) => {
    jest.setSystemTime(new Date(iso));
    return service.record({
      actor: 'admin@inversioneslr.com',
      action: AuditAction.LOGIN,
      entity: 'AuthSession',
      result: AuditResult.EXITOSO,
      ...overrides,
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    service = new AuditService();
    controller = new AuditController(service);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('CA1 · Actor, acción, entidad, fecha y hora y resultado, del más reciente al más antiguo y paginados', () => {
    it('devuelve los eventos completos del más reciente al más antiguo', () => {
      const first = recordAt('2026-10-01T10:00:00.000Z');
      const third = recordAt('2026-10-03T10:00:00.000Z', { action: AuditAction.EXPORT, entity: 'Report' });
      const second = recordAt('2026-10-02T10:00:00.000Z', { result: AuditResult.FALLIDO });

      const page = controller.findAll({});

      expect(page.data.map((event) => event.id)).toEqual([third.id, second.id, first.id]);
      page.data.forEach((event) =>
        expect(event).toEqual(
          expect.objectContaining({
            actor: expect.any(String),
            action: expect.any(String),
            entity: expect.any(String),
            occurredAt: expect.any(String),
            result: expect.any(String),
          }),
        ),
      );
    });

    it('con la misma fecha y hora, muestra primero el último registrado', () => {
      const older = recordAt('2026-10-01T10:00:00.000Z');
      const newer = recordAt('2026-10-01T10:00:00.000Z');

      expect(controller.findAll({}).data.map((event) => event.id)).toEqual([newer.id, older.id]);
    });

    it('pagina los resultados e informa el total y el número de páginas', () => {
      for (let day = 1; day <= 25; day += 1) {
        recordAt(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);
      }

      const firstPage = controller.findAll({ page: 1, limit: 10 });
      expect(firstPage).toMatchObject({ page: 1, limit: 10, total: 25, totalPages: 3 });
      expect(firstPage.data).toHaveLength(10);
      expect(firstPage.data[0].occurredAt).toBe('2026-10-25T12:00:00.000Z');

      const lastPage = controller.findAll({ page: 3, limit: 10 });
      expect(lastPage.data).toHaveLength(5);
      expect(lastPage.data[4].occurredAt).toBe('2026-10-01T12:00:00.000Z');
    });

    it('usa 20 eventos por página por defecto y no supera el máximo', () => {
      for (let i = 0; i < 120; i += 1) {
        recordAt(new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString());
      }

      expect(controller.findAll({}).data).toHaveLength(DEFAULT_AUDIT_PAGE_SIZE);
      expect(service.findPage({ limit: 500 }).limit).toBe(MAX_AUDIT_PAGE_SIZE);
    });

    it('una página fuera de rango devuelve la última disponible', () => {
      recordAt('2026-10-01T10:00:00.000Z');

      expect(controller.findAll({ page: 9 })).toMatchObject({ page: 1, total: 1, totalPages: 1 });
    });

    it('sin eventos devuelve una página vacía', () => {
      expect(controller.findAll({})).toEqual({ data: [], page: 1, limit: DEFAULT_AUDIT_PAGE_SIZE, total: 0, totalPages: 1 });
    });
  });

  describe('CA2 · Solo los eventos que cumplen todos los filtros', () => {
    beforeEach(() => {
      recordAt('2026-09-30T15:00:00.000Z', { actor: 'huesped@prueba.com', action: AuditAction.BOOKING_STATUS_CHANGE, entity: 'Booking' });
      recordAt('2026-10-05T15:00:00.000Z', { actor: 'huesped@prueba.com', action: AuditAction.BOOKING_CANCELLATION, entity: 'Booking' });
      recordAt('2026-10-10T15:00:00.000Z', { actor: 'anfitrion@prueba.com', action: AuditAction.LISTING_STATUS_CHANGE, entity: 'Listing' });
      recordAt('2026-10-20T15:00:00.000Z', { actor: 'huesped@prueba.com', action: AuditAction.BOOKING_STATUS_CHANGE, entity: 'Booking' });
      recordAt('2026-10-20T16:00:00.000Z', { actor: 'huesped@prueba.com', action: AuditAction.LOGIN, entity: 'AuthSession', result: AuditResult.FALLIDO });
    });

    it('filtra por rango de fechas, ambos extremos incluidos', () => {
      const page = controller.findAll({ from: '2026-10-05', to: '2026-10-10' });

      expect(page.total).toBe(2);
      expect(page.data.map((event) => event.action)).toEqual([AuditAction.LISTING_STATUS_CHANGE, AuditAction.BOOKING_CANCELLATION]);
    });

    it('interpreta las fechas en hora de Bogotá', () => {
      // 2026-10-02 02:00 UTC es todavía el 1 de octubre en Bogotá (UTC-5).
      const lateNight = recordAt('2026-10-02T02:00:00.000Z', { actor: 'nocturno@prueba.com' });

      expect(controller.findAll({ to: '2026-10-01', actor: 'nocturno' }).data).toEqual([lateNight]);
      expect(controller.findAll({ from: '2026-10-02', actor: 'nocturno' }).total).toBe(0);
    });

    it('acepta instantes ISO completos en el rango', () => {
      const page = controller.findAll({ from: '2026-10-20T15:30:00.000Z' });

      expect(page.data.map((event) => event.action)).toEqual([AuditAction.LOGIN]);
    });

    it('filtra por usuario aunque se escriba solo una parte del correo y en mayúsculas', () => {
      expect(controller.findAll({ actor: 'ANFITRION' }).total).toBe(1);
      expect(controller.findAll({ actor: 'huesped@prueba.com' }).total).toBe(4);
    });

    it('filtra por tipo de evento y por entidad', () => {
      expect(controller.findAll({ action: AuditAction.BOOKING_STATUS_CHANGE }).total).toBe(2);
      expect(controller.findAll({ entity: 'Listing' }).total).toBe(1);
    });

    it('combina todos los filtros a la vez', () => {
      const page = controller.findAll({
        from: '2026-10-01',
        to: '2026-10-31',
        actor: 'huesped',
        action: AuditAction.BOOKING_STATUS_CHANGE,
        entity: 'Booking',
      });

      expect(page.total).toBe(1);
      expect(page.data[0]).toMatchObject({ occurredAt: '2026-10-20T15:00:00.000Z', actor: 'huesped@prueba.com' });
    });

    it('combina los filtros con el resultado', () => {
      expect(controller.findAll({ actor: 'huesped', result: AuditResult.FALLIDO }).data.map((event) => event.action)).toEqual([
        AuditAction.LOGIN,
      ]);
    });

    it('si ningún evento cumple los filtros, la página llega vacía', () => {
      expect(controller.findAll({ actor: 'anfitrion', entity: 'Booking' })).toMatchObject({ data: [], total: 0 });
    });

    it('rechaza una fecha inicial posterior a la final', () => {
      expect(() => controller.findAll({ from: '2026-10-20', to: '2026-10-01' })).toThrow(BadRequestException);
    });

    it('rechaza una fecha que no existe', () => {
      expect(() => service.findAll({ from: 'ayer' })).toThrow(BadRequestException);
    });
  });
});
