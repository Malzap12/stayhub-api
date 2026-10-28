import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { HEADER_ROW, ReportExportService, buildTotalRow, extractPdfText } from './report-export.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService, UserAccount } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditAction } from '../../common/enums/audit.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { ListingResponseDto } from '../listings/dto/listing-response.dto';

describe('HU-058 y HU-059 · Exportar reportes a Excel y PDF (CA1, CA2, RF-076, RF-077, RN-026)', () => {
  let controller: ReportsController;
  let exporter: ReportExportService;
  let dashboard: ReportsService;
  let audit: AuditService;
  let users: Map<string, UserAccount>;
  let listings: ListingResponseDto[];
  let bookings: BookingResponseDto[];
  const now = new Date('2026-10-28T15:30:00Z');

  const account = (email: string, role: Role, createdAt: string, status: UserAccount['status'] = 'ACTIVA'): UserAccount => ({
    id: `id-${email}`, name: email.split('@')[0], email, passwordHash: 'secreto', role, status, createdAt: new Date(createdAt),
  });
  const listing = (id: string, city: string, propertyType: string, status = ListingStatus.ACTIVA) =>
    ({ id, title: `Título ${id}`, city, propertyType, status, pricePerNight: 200_000, maxGuests: 4, hostId: 'host', hostName: 'Ana', createdAt: new Date('2026-10-05T12:00:00Z') }) as unknown as ListingResponseDto;
  let seq = 0;
  const booking = (listingId: string, status: BookingStatus, totalAmount: number, serviceFee: number, createdAt = '2026-10-10T12:00:00Z', nights = 2): BookingResponseDto => ({
    id: `b-${++seq}`, code: `RES-${seq}`, listingId, guestId: 'h1@prueba.com', checkIn: '2026-11-01', checkOut: `2026-11-0${1 + nights}`, guests: 2,
    totalAmount, serviceFee, currency: 'COP', status, idempotencyKey: `k-${seq}`, createdAt: new Date(createdAt),
  });

  const read = async (buffer: Buffer): Promise<Worksheet> => {
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as never);
    return workbook.worksheets[0];
  };
  const dataRows = (sheet: Worksheet) => {
    const rows: unknown[][] = [];
    for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
      const first = sheet.getRow(r).getCell(1).value;
      if (typeof first === 'string' && first.startsWith('Total:')) break;
      if (first !== null && first !== undefined) rows.push((sheet.getRow(r).values as unknown[]).slice(1));
    }
    return rows;
  };
  const totalRow = (sheet: Worksheet) => (sheet.getRow(sheet.rowCount).values as unknown[]).slice(1);
  const headers = (sheet: Worksheet) => (sheet.getRow(HEADER_ROW).values as unknown[]).slice(1);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [ReportsService, ReportExportService, BookingsService, ListingsService, PlatformConfigService, AuditService, PaymentsService, NotificationsService, AuthService],
    }).compile();
    controller = module.get(ReportsController);
    exporter = module.get(ReportExportService);
    dashboard = module.get(ReportsService);
    audit = module.get(AuditService);
    users = (module.get(AuthService) as unknown as { users: Map<string, UserAccount> }).users;
    listings = (module.get(ListingsService) as unknown as { listingsStore: ListingResponseDto[] }).listingsStore;
    bookings = (module.get(BookingsService) as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;

    // CA2: conjunto de datos conocido.
    users.clear();
    users.set('h1@prueba.com', account('h1@prueba.com', Role.HUESPED, '2026-10-02T12:00:00Z'));
    users.set('h2@prueba.com', account('h2@prueba.com', Role.HUESPED, '2026-10-20T12:00:00Z', 'RESTRINGIDA'));
    users.set('a1@prueba.com', account('a1@prueba.com', Role.ANFITRION, '2026-10-03T12:00:00Z'));
    users.set('admin@prueba.com', account('admin@prueba.com', Role.ADMINISTRADOR, '2026-09-01T12:00:00Z'));
    listings.length = 0;
    listings.push(
      listing('med-apto', 'Medellín', 'APARTAMENTO'),
      listing('med-casa', 'Medellín', 'CASA'),
      listing('bog-apto', 'Bogotá', 'APARTAMENTO'),
      listing('bog-pausa', 'Bogotá', 'CABANA', ListingStatus.PAUSADA),
    );
    bookings.length = 0;
    bookings.push(
      booking('med-apto', BookingStatus.CONFIRMADA, 1_000_000, 100_000),
      booking('med-apto', BookingStatus.COMPLETADA, 500_000, 50_000, '2026-10-12T12:00:00Z', 3),
      booking('med-casa', BookingStatus.CONFIRMADA, 800_000, 80_000),
      booking('bog-apto', BookingStatus.CONFIRMADA, 300_000.5, 30_000.25, '2026-10-25T12:00:00Z'),
      booking('bog-apto', BookingStatus.CANCELADA, 700_000, 70_000),
      booking('bog-pausa', BookingStatus.PENDIENTE, 400_000, 40_000),
    );
  });

  it('CA1: descarga un .xlsx con título, fecha de generación, filtros, encabezados con autofiltro y totales', async () => {
    const headersSet: Record<string, string> = {};
    const res = { set: (values: Record<string, string>) => Object.assign(headersSet, values) };

    const file = await controller.exportReport('reservas', {}, res as never, { email: 'admin@prueba.com' } as never);

    expect(file).toBeInstanceOf(StreamableFile);
    expect(headersSet['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(headersSet['Content-Disposition']).toMatch(/^attachment; filename="stayhub-reservas-\d{8}T\d{4}\.xlsx"$/);

    const { buffer } = await exporter.export('reservas', { status: 'CONFIRMADA' }, 'admin@prueba.com', now);
    const sheet = await read(buffer);
    expect(sheet.getCell('A1').value).toBe('Reporte de reservas');
    expect(sheet.getCell('A2').value).toBe('Generado el 2026-10-28 10:30 (hora de Colombia)');
    expect(sheet.getCell('A3').value).toBe('Filtros aplicados: estado CONFIRMADA');
    expect(headers(sheet)).toEqual(['Código', 'Alojamiento', 'Ciudad', 'Huésped', 'Llegada', 'Salida', 'Huéspedes', 'Estado', 'Total', 'Tarifa de servicio', 'Moneda', 'Creada el']);
    expect(sheet.autoFilter).toBe(`A${HEADER_ROW}:L${HEADER_ROW}`);
    expect(dataRows(sheet).every((row) => row[7] === 'CONFIRMADA')).toBe(true);
    expect(totalRow(sheet)[0]).toBe('Total: 3 fila(s)');
  });

  it('CA1: hay cinco reportes y cada uno trae sus encabezados; uno desconocido responde 404', async () => {
    const expected: Record<string, string> = {
      usuarios: 'Reporte de usuarios',
      publicaciones: 'Reporte de publicaciones',
      reservas: 'Reporte de reservas',
      ingresos: 'Reporte de ingresos estimados',
      demanda: 'Reporte de demanda por ciudad y tipo',
    };
    for (const [report, title] of Object.entries(expected)) {
      const sheet = await read((await exporter.export(report, {}, 'admin@prueba.com', now)).buffer);
      expect(sheet.getCell('A1').value).toBe(title);
      expect(sheet.getCell('A3').value).toBe('Filtros aplicados: ninguno (todos los registros)');
      expect(headers(sheet).length).toBeGreaterThan(3);
    }
    await expect(exporter.export('secretos', {}, 'admin@prueba.com', now)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CA2: los totales de usuarios, publicaciones y reservas coinciden con el dashboard', async () => {
    const indicators = dashboard.getDashboard();

    const usersSheet = await read((await exporter.export('usuarios', {}, 'x', now)).buffer);
    expect(dataRows(usersSheet)).toHaveLength(indicators.usersByRole.total);
    expect(dataRows(usersSheet).filter((row) => row[2] === 'HUESPED')).toHaveLength(indicators.usersByRole.HUESPED);
    // Nunca se exporta la contraseña.
    expect(JSON.stringify(dataRows(usersSheet))).not.toContain('secreto');

    const listingsSheet = await read((await exporter.export('publicaciones', { status: 'ACTIVA' }, 'x', now)).buffer);
    expect(dataRows(listingsSheet)).toHaveLength(indicators.activeListings);

    const bookingsSheet = await read((await exporter.export('reservas', {}, 'x', now)).buffer);
    expect(dataRows(bookingsSheet)).toHaveLength(indicators.bookingsByStatus.total);
    expect(totalRow(bookingsSheet)[8]).toBe(3_700_000.5);
  });

  it('CA2: los ingresos y la demanda suman lo mismo que los ingresos estimados del dashboard', async () => {
    const { estimatedRevenue } = dashboard.getDashboard();

    const revenue = await read((await exporter.export('ingresos', {}, 'x', now)).buffer);
    expect(dataRows(revenue)).toHaveLength(estimatedRevenue.bookings);
    expect(totalRow(revenue).slice(5)).toEqual([estimatedRevenue.grossBookingValue, estimatedRevenue.platformFees]);
    expect(estimatedRevenue).toMatchObject({ grossBookingValue: 2_600_000.5, platformFees: 260_000.25, bookings: 4 });

    const demand = await read((await exporter.export('demanda', {}, 'x', now)).buffer);
    expect(dataRows(demand)).toEqual([
      ['Medellín', 'APARTAMENTO', 2, 5, 1_500_000],
      ['Medellín', 'CASA', 1, 2, 800_000],
      ['Bogotá', 'APARTAMENTO', 1, 2, 300_000.5],
    ]);
    expect(totalRow(demand).slice(2)).toEqual([estimatedRevenue.bookings, 9, estimatedRevenue.grossBookingValue]);
  });

  it('CA1: aplica los filtros de fecha y ciudad, y los escribe en el archivo', async () => {
    const filters = { from: '2026-10-11', to: '2026-10-31', city: 'medellin' };
    const sheet = await read((await exporter.export('reservas', filters, 'x', now)).buffer);

    expect(sheet.getCell('A3').value).toBe('Filtros aplicados: desde 2026-10-11, hasta 2026-10-31, ciudad medellin');
    expect(dataRows(sheet).map((row) => [row[1], row[7]])).toEqual([['Título med-apto', 'COMPLETADA']]);
    expect(() => exporter.buildTable('reservas', { from: '2026-10-31', to: '2026-10-01' })).toThrow(BadRequestException);
  });

  it('la exportación queda en la auditoría', async () => {
    await exporter.export('ingresos', { city: 'Bogotá' }, 'admin@prueba.com', now);
    expect(audit.findAll({ action: AuditAction.EXPORT }).at(-1)).toMatchObject({
      actor: 'admin@prueba.com',
      entityId: 'ingresos',
      detail: 'Exportó reporte de ingresos estimados a Excel (1 filas). Filtros: ciudad Bogotá',
    });
  });

  describe('HU-059 · Exportar reportes a PDF (CA1, CA2, RF-076, RF-077, RN-026)', () => {
    it('CA1: descarga un documento .pdf con título, filtros, fecha de generación, tabla de datos y totales', async () => {
      const headersSet: Record<string, string> = {};
      const res = { set: (values: Record<string, string>) => Object.assign(headersSet, values) };

      const file = await controller.exportReportPdf('reservas', { status: 'CONFIRMADA' }, res as never, { email: 'admin@prueba.com' } as never);

      expect(file).toBeInstanceOf(StreamableFile);
      expect(headersSet['Content-Type']).toBe('application/pdf');
      expect(headersSet['Content-Disposition']).toMatch(/^attachment; filename="stayhub-reservas-\d{8}T\d{4}\.pdf"$/);

      const { buffer, rows } = await exporter.exportPdf('reservas', { status: 'CONFIRMADA' }, 'admin@prueba.com', now);
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(rows).toBe(3);

      const text = extractPdfText(buffer);
      expect(text).toContain('Reporte de reservas');
      expect(text).toContain('Generado el 2026-10-28 10:30 (hora de Colombia)');
      expect(text).toContain('Filtros aplicados: estado CONFIRMADA');
      expect(text).toContain('Código');
      expect(text).toContain('Alojamiento');
      expect(text).toContain('Total: 3 fila(s)');
      expect(text).toContain('2100000.5');
      expect(text).toContain('210000.25');
    });

    it('CA2: usando el mismo filtro, los totales del PDF coinciden exactamente con los de Excel en los 5 reportes', async () => {
      const scenarios: Array<{ report: 'usuarios' | 'publicaciones' | 'reservas' | 'ingresos' | 'demanda'; filters: Record<string, string> }> = [
        { report: 'usuarios', filters: { status: 'ACTIVA' } },
        { report: 'publicaciones', filters: { city: 'Medellín' } },
        { report: 'reservas', filters: { from: '2026-10-01', to: '2026-10-31', status: 'CONFIRMADA' } },
        { report: 'ingresos', filters: { city: 'Medellín' } },
        { report: 'demanda', filters: {} },
      ];

      for (const { report, filters } of scenarios) {
        const xlsxResult = await exporter.export(report, filters, 'admin@prueba.com', now);
        const pdfResult = await exporter.exportPdf(report, filters, 'admin@prueba.com', now);

        expect(pdfResult.rows).toBe(xlsxResult.rows);

        const sheet = await read(xlsxResult.buffer);
        const excelTotals = totalRow(sheet).filter((cell) => cell !== null && cell !== undefined);
        const expectedTotals = buildTotalRow(exporter.buildTable(report, filters)).filter((cell) => cell !== null);
        expect(excelTotals).toEqual(expectedTotals);

        const pdfText = extractPdfText(pdfResult.buffer);
        for (const totalValue of expectedTotals) {
          expect(pdfText).toContain(String(totalValue));
        }
      }
    });

    it('CA1: pagina automáticamente cuando hay muchas filas, registra en auditoría y lanza 404 en reporte inexistente', async () => {
      for (let i = 0; i < 30; i++) {
        bookings.push(booking('med-apto', BookingStatus.CONFIRMADA, 100_000, 10_000));
      }
      const { buffer, rows } = await exporter.exportPdf('reservas', {}, 'admin@prueba.com', now);
      expect(rows).toBe(36);
      expect(extractPdfText(buffer)).toContain('Total: 36 fila(s)');

      expect(audit.findAll({ action: AuditAction.EXPORT }).at(-1)).toMatchObject({
        actor: 'admin@prueba.com',
        entityId: 'reservas',
        detail: 'Exportó reporte de reservas a PDF (36 filas). Filtros: ninguno (todos los registros)',
      });

      await expect(exporter.exportPdf('inexistente', {}, 'admin@prueba.com', now)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
