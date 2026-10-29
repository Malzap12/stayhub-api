import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportExportService } from './report-export.service';
import { AuditController } from '../audit/audit.controller';
import { ANONYMOUS_ACTOR, AuditService } from '../audit/audit.service';
import { AuthService, UserAccount } from '../auth/auth.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { ListingResponseDto } from '../listings/dto/listing-response.dto';
import { ActiveSession } from '../auth/auth.service';

/**
 * HU-060 · Registrar las exportaciones (CA1, CA2 · RF-078, RN-027).
 * Épica EP-14 · Auditoría y trazabilidad.
 */
describe('HU-060 · Registrar las exportaciones (CA1, CA2 · RF-078, RN-027)', () => {
  let controller: ReportsController;
  let auditController: AuditController;
  let exporter: ReportExportService;
  let auditService: AuditService;

  const AUDITOR_EMAIL = 'auditor.responsable@inversioneslr.com';
  const AUDITOR_SESSION: ActiveSession = {
    token: 'jwt-token-auditor',
    userId: 'usr-auditor-1',
    email: AUDITOR_EMAIL,
    role: Role.ADMINISTRADOR,
    expiresAt: Date.now() + 3600_000,
  };

  const mockResponse = (): Response =>
    ({
      set: jest.fn(),
      setHeader: jest.fn(),
    }) as unknown as Response;

  beforeEach(async () => {
    const users = new Map<string, UserAccount>([
      [
        AUDITOR_EMAIL,
        {
          id: 'usr-auditor-1',
          name: 'Auditor Responsable',
          email: AUDITOR_EMAIL,
          passwordHash: 'hash',
          role: Role.ADMINISTRADOR,
          status: 'ACTIVA',
          createdAt: new Date('2026-01-01T10:00:00Z'),
        },
      ],
      [
        'huesped@stayhub.com',
        {
          id: 'usr-huesped-1',
          name: 'Huésped Prueba',
          email: 'huesped@stayhub.com',
          passwordHash: 'hash',
          role: Role.HUESPED,
          status: 'ACTIVA',
          createdAt: new Date('2026-02-15T12:00:00Z'),
        },
      ],
    ]);

    const listings: ListingResponseDto[] = [
      {
        id: 'list-1',
        title: 'Apartamento Poblado',
        city: 'Medellín',
        propertyType: 'APARTAMENTO',
        status: ListingStatus.ACTIVA,
        pricePerNight: 250_000,
        maxGuests: 4,
        bedrooms: 2,
        bathrooms: 2,
        amenities: [],
        images: [],
        hostId: 'host-1',
        hostName: 'Carlos',
        createdAt: new Date('2026-03-01T10:00:00Z'),
      } as unknown as ListingResponseDto,
    ];

    const bookings: BookingResponseDto[] = [
      {
        id: 'bk-1',
        code: 'RES-1001',
        listingId: 'list-1',
        guestId: 'usr-huesped-1',
        checkIn: '2026-11-01',
        checkOut: '2026-11-05',
        guests: 2,
        totalAmount: 1_000_000,
        serviceFee: 100_000,
        currency: 'COP',
        status: BookingStatus.CONFIRMADA,
        idempotencyKey: 'idemp-1',
        createdAt: new Date('2026-10-15T08:00:00Z'),
      },
    ];

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController, AuditController],
      providers: [
        ReportsService,
        ReportExportService,
        AuditService,
        {
          provide: AuthService,
          useValue: {
            listAccounts: () => [...users.values()],
          },
        },
        {
          provide: ListingsService,
          useValue: {
            findAllForAdmin: () => listings,
          },
        },
        {
          provide: BookingsService,
          useValue: {
            getAllBookings: () => bookings,
          },
        },
      ],
    }).compile();

    controller = module.get(ReportsController);
    auditController = module.get(AuditController);
    exporter = module.get(ReportExportService);
    auditService = module.get(AuditService);
  });

  describe('CA1 · Registro de exportación con usuario, fecha y hora, tipo de reporte, formato y filtros', () => {
    it('registra exportación a Excel (.xlsx) con todos los atributos requeridos', async () => {
      const fixedNow = new Date('2026-10-28T16:00:00Z');
      const filters = { from: '2026-10-01', to: '2026-10-31', status: 'CONFIRMADA', city: 'Medellín' };

      const result = await exporter.export('reservas', filters, AUDITOR_EMAIL, fixedNow);
      expect(result.fileName).toContain('stayhub-reservas-');
      expect(result.fileName).toMatch(/\.xlsx$/);

      const events = auditService.findAll({ action: AuditAction.EXPORT });
      expect(events).toHaveLength(1);

      const [event] = events;
      // Usuario que solicitó la exportación
      expect(event.actor).toBe(AUDITOR_EMAIL);
      // Acción de exportación
      expect(event.action).toBe(AuditAction.EXPORT);
      // Entidad y tipo de reporte
      expect(event.entity).toBe('Report');
      expect(event.entityId).toBe('reservas');
      // Resultado exitoso
      expect(event.result).toBe(AuditResult.EXITOSO);
      // Fecha y hora registrada
      expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
      // Detalle y metadatos con formato y filtros
      expect(event.detail).toContain('Excel');
      expect(event.detail).toContain('desde 2026-10-01');
      expect(event.detail).toContain('hasta 2026-10-31');
      expect(event.detail).toContain('ciudad Medellín');
      expect(event.detail).toContain('estado CONFIRMADA');
      expect(event.metadata).toEqual({
        report: 'reservas',
        format: 'xlsx',
        filters,
      });
    });

    it('registra exportación a PDF (.pdf) con formato identificado y filtros limpios', async () => {
      const fixedNow = new Date('2026-10-28T16:05:00Z');
      const result = await exporter.exportPdf('usuarios', {}, AUDITOR_EMAIL, fixedNow);
      expect(result.fileName).toMatch(/\.pdf$/);

      const events = auditService.findAll({ action: AuditAction.EXPORT });
      expect(events).toHaveLength(1);

      const [event] = events;
      expect(event.actor).toBe(AUDITOR_EMAIL);
      expect(event.action).toBe(AuditAction.EXPORT);
      expect(event.entity).toBe('Report');
      expect(event.entityId).toBe('usuarios');
      expect(event.detail).toContain('PDF');
      expect(event.detail).toContain('ninguno (todos los registros)');
      expect(event.metadata).toEqual({
        report: 'usuarios',
        format: 'pdf',
        filters: {},
      });
    });

    it('registra la exportación invocada a través de ReportsController inyectando el usuario autenticado', async () => {
      const res = mockResponse();
      const file = await controller.exportReport('ingresos', {}, res, AUDITOR_SESSION);
      expect(file).toBeInstanceOf(StreamableFile);

      const events = auditService.findAll({ action: AuditAction.EXPORT });
      expect(events.length).toBeGreaterThanOrEqual(1);

      const last = events.at(-1)!;
      expect(last.actor).toBe(AUDITOR_EMAIL);
      expect(last.entityId).toBe('ingresos');
      expect(last.metadata?.format).toBe('xlsx');
    });

    it('registra la exportación a PDF invocada a través de ReportsController', async () => {
      const res = mockResponse();
      const file = await controller.exportReportPdf('demanda', { city: 'Medellín' }, res, AUDITOR_SESSION);
      expect(file).toBeInstanceOf(StreamableFile);

      const last = auditService.findAll({ action: AuditAction.EXPORT }).at(-1)!;
      expect(last.actor).toBe(AUDITOR_EMAIL);
      expect(last.entityId).toBe('demanda');
      expect(last.metadata?.format).toBe('pdf');
      expect(last.detail).toContain('ciudad Medellín');
    });

    it('asigna actor anónimo si no se suministra sesión en la llamada directa al servicio', async () => {
      await exporter.export('publicaciones', {});
      const [event] = auditService.findAll({ action: AuditAction.EXPORT });
      expect(event.actor).toBe(ANONYMOUS_ACTOR);
    });

    it('lanza NotFoundException sin registrar auditoría si el tipo de reporte no existe', async () => {
      await expect(exporter.export('reporte-fantasma', {}, AUDITOR_EMAIL)).rejects.toBeInstanceOf(NotFoundException);
      expect(auditService.findAll({ action: AuditAction.EXPORT })).toHaveLength(0);
    });
  });

  describe('CA2 · Consulta de eventos de exportación en la bitácora de auditoría', () => {
    beforeEach(async () => {
      // Generar varias exportaciones
      await exporter.export('reservas', { status: 'CONFIRMADA' }, AUDITOR_EMAIL);
      await exporter.exportPdf('usuarios', { status: 'ACTIVA' }, AUDITOR_EMAIL);
      await exporter.export('ingresos', {}, 'otro.admin@stayhub.com');

      // Generar otro evento no relacionado para verificar filtros
      auditService.record({
        actor: AUDITOR_EMAIL,
        action: AuditAction.LOGIN,
        entity: 'AuthSession',
        result: AuditResult.EXITOSO,
      });
    });

    it('retorna eventos de exportación al consultar la auditoría general', () => {
      const allEvents = auditController.findAll({}).data;
      const exportEvents = allEvents.filter((e) => e.action === AuditAction.EXPORT);
      expect(exportEvents).toHaveLength(3);
    });

    it('filtra exclusivamente eventos de exportación mediante action=EXPORT', () => {
      const exportEvents = auditController.findAll({ action: AuditAction.EXPORT }).data;
      expect(exportEvents).toHaveLength(3);
      expect(exportEvents.every((e) => e.action === AuditAction.EXPORT)).toBe(true);
      expect(exportEvents.map((e) => e.entityId)).toEqual(['ingresos', 'usuarios', 'reservas']);
    });

    it('permite filtrar exportaciones por actor específico', () => {
      const auditorExports = auditController.findAll({
        action: AuditAction.EXPORT,
        actor: AUDITOR_EMAIL,
      }).data;
      expect(auditorExports).toHaveLength(2);
      expect(auditorExports.every((e) => e.actor === AUDITOR_EMAIL)).toBe(true);
    });

    it('garantiza la inmutabilidad de los eventos de exportación registrados (solo inserción)', () => {
      const [firstExport] = auditController.findAll({ action: AuditAction.EXPORT }).data;

      expect(() => auditController.replace(firstExport.id, AUDITOR_SESSION)).toThrow();
      expect(() => auditController.update(firstExport.id, AUDITOR_SESSION)).toThrow();
      expect(() => auditController.remove(firstExport.id, AUDITOR_SESSION)).toThrow();
    });
  });
});
