import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { AuthService } from '../auth/auth.service';
import { BookingsService, bogotaDate } from '../bookings/bookings.service';
import { ListingsService, normalizeCity } from '../listings/listings.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { REVENUE_CURRENCY, REVENUE_STATUSES } from './reports.service';
import { EXPORTABLE_REPORTS, ExportableReport, ExportReportQueryDto } from './dto/export-report.dto';

interface PdfDoc {
  page: { width: number; height: number };
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  font(name: string): this;
  fontSize(size: number): this;
  fillColor(color: string): this;
  text(text: string, x: number, y: number, options?: Record<string, unknown>): this;
  rect(x: number, y: number, w: number, h: number): this;
  fill(color: string): this;
  addPage(options?: Record<string, unknown>): this;
  end(): void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as new (options?: Record<string, unknown>) => PdfDoc;

type Cell = string | number | Date | null;

interface ReportColumn {
  header: string;
  width: number;
  /** Formato numérico de Excel (moneda, entero o fecha). */
  numFmt?: string;
  /** Si se suma en la fila de totales. */
  total?: boolean;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Cell[][];
}

export interface ExportedReport {
  fileName: string;
  buffer: Buffer;
  rows: number;
}

/** Fila del encabezado de la tabla: debajo del título, la fecha de generación, los filtros y una fila en blanco. */
export const HEADER_ROW = 5;

const COP = '"$"#,##0';
const INT = '#,##0';
const DATE = 'yyyy-mm-dd';

const TITLES: Record<ExportableReport, string> = {
  usuarios: 'Reporte de usuarios',
  publicaciones: 'Reporte de publicaciones',
  reservas: 'Reporte de reservas',
  ingresos: 'Reporte de ingresos estimados',
  demanda: 'Reporte de demanda por ciudad y tipo',
};

const asDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const dayOnly = (value: unknown): Date | null => {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
};

/**
 * HU-058 · Exportar reportes a Excel y HU-059 · Exportar reportes a PDF (CA1, CA2 · RF-076, RF-077, RN-026).
 * Cinco reportes (AMB-23): usuarios, publicaciones, reservas, ingresos estimados y demanda por ciudad y tipo.
 * Tanto el archivo .xlsx como el documento .pdf se construyen con la misma tabla y fila de totales (`buildTable` y
 * `buildTotalRow`), por lo que con el mismo filtro los totales de Excel y PDF coinciden exactamente (HU-059 CA2).
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly authService: AuthService,
    private readonly listingsService: ListingsService,
    private readonly bookingsService: BookingsService,
    private readonly auditService: AuditService,
  ) {}

  /** Tabla del reporte con los filtros aplicados (también la usan las pruebas para comparar totales). */
  buildTable(report: ExportableReport, filters: ExportReportQueryDto = {}): ReportTable {
    if (filters.from && filters.to && filters.from.slice(0, 10) > filters.to.slice(0, 10)) {
      throw new BadRequestException('La fecha inicial no puede ser posterior a la fecha final');
    }
    const inRange = (created: unknown) => {
      const day = created ? bogotaDate(new Date(created as string)) : undefined;
      return (!filters.from || (!!day && day >= filters.from.slice(0, 10))) && (!filters.to || (!!day && day <= filters.to.slice(0, 10)));
    };
    const city = filters.city ? normalizeCity(filters.city) : undefined;
    const cityMatches = (value?: string) => !city || normalizeCity(value ?? '') === city;
    const statusMatches = (value?: string) => !filters.status || value === filters.status;

    const listings = this.listingsService.findAllForAdmin();
    const listingById = new Map(listings.map((listing) => [listing.id, listing]));
    const bookings = this.bookingsService
      .getAllBookings()
      .filter((booking) => inRange(booking.createdAt) && cityMatches(listingById.get(booking.listingId)?.city));
    const paid = bookings.filter(
      (booking) => REVENUE_STATUSES.includes(booking.status) && (booking.currency ?? REVENUE_CURRENCY) === REVENUE_CURRENCY,
    );

    switch (report) {
      case 'usuarios':
        return {
          title: TITLES.usuarios,
          columns: [
            { header: 'Nombre', width: 28 },
            { header: 'Correo', width: 34 },
            { header: 'Rol', width: 16 },
            { header: 'Estado', width: 14 },
            { header: 'Registrado el', width: 14, numFmt: DATE },
          ],
          rows: this.authService
            .listAccounts()
            .filter((account) => inRange(account.createdAt) && statusMatches(account.status))
            .sort((a, b) => (asDate(a.createdAt)?.getTime() ?? 0) - (asDate(b.createdAt)?.getTime() ?? 0))
            .map((account) => [account.name, account.email, account.role, account.status, asDate(account.createdAt)]),
        };

      case 'publicaciones':
        return {
          title: TITLES.publicaciones,
          columns: [
            { header: 'ID', width: 38 },
            { header: 'Título', width: 36 },
            { header: 'Ciudad', width: 18 },
            { header: 'Tipo', width: 14 },
            { header: 'Estado', width: 20 },
            { header: 'Precio por noche (COP)', width: 22, numFmt: COP },
            { header: 'Capacidad', width: 11, numFmt: INT },
            { header: 'Anfitrión', width: 24 },
            { header: 'Creada el', width: 14, numFmt: DATE },
          ],
          rows: listings
            .filter((listing) => inRange(listing.createdAt) && cityMatches(listing.city) && statusMatches(listing.status))
            .map((listing) => [
              listing.id,
              listing.title,
              listing.city ?? '',
              listing.propertyType ?? '',
              listing.status ?? '',
              listing.pricePerNight ?? null,
              listing.maxGuests ?? null,
              listing.hostName ?? '',
              asDate(listing.createdAt),
            ]),
        };

      case 'reservas':
        return {
          title: TITLES.reservas,
          columns: [
            { header: 'Código', width: 16 },
            { header: 'Alojamiento', width: 34 },
            { header: 'Ciudad', width: 18 },
            { header: 'Huésped', width: 32 },
            { header: 'Llegada', width: 12, numFmt: DATE },
            { header: 'Salida', width: 12, numFmt: DATE },
            { header: 'Huéspedes', width: 11, numFmt: INT },
            { header: 'Estado', width: 14 },
            { header: 'Total', width: 16, numFmt: '#,##0.00', total: true },
            { header: 'Tarifa de servicio', width: 18, numFmt: '#,##0.00', total: true },
            { header: 'Moneda', width: 9 },
            { header: 'Creada el', width: 14, numFmt: DATE },
          ],
          rows: bookings
            .filter((booking) => statusMatches(booking.status))
            .map((booking) => {
              const listing = listingById.get(booking.listingId);
              return [
                booking.code ?? booking.id,
                listing?.title ?? booking.listingId,
                listing?.city ?? '',
                booking.guestId,
                dayOnly(booking.checkIn),
                dayOnly(booking.checkOut),
                booking.guests,
                booking.status,
                Number(booking.totalAmount ?? 0),
                Number(booking.serviceFee ?? 0),
                booking.currency ?? REVENUE_CURRENCY,
                asDate(booking.createdAt),
              ];
            }),
        };

      case 'ingresos':
        return {
          title: TITLES.ingresos,
          columns: [
            { header: 'Código', width: 16 },
            { header: 'Alojamiento', width: 34 },
            { header: 'Ciudad', width: 18 },
            { header: 'Estado', width: 14 },
            { header: 'Salida', width: 12, numFmt: DATE },
            { header: 'Valor de la reserva (COP)', width: 24, numFmt: COP, total: true },
            { header: 'Comisión de la plataforma (COP)', width: 30, numFmt: COP, total: true },
          ],
          rows: paid.map((booking) => {
            const listing = listingById.get(booking.listingId);
            return [
              booking.code ?? booking.id,
              listing?.title ?? booking.listingId,
              listing?.city ?? '',
              booking.status,
              dayOnly(booking.checkOut),
              Number(booking.totalAmount ?? 0),
              Number(booking.serviceFee ?? 0),
            ];
          }),
        };

      case 'demanda': {
        const groups = new Map<string, { city: string; type: string; bookings: number; nights: number; value: number }>();
        for (const booking of paid) {
          const listing = listingById.get(booking.listingId);
          if (!listing?.city) continue;
          const key = `${listing.city}|${listing.propertyType ?? ''}`;
          const group = groups.get(key) ?? { city: listing.city, type: listing.propertyType ?? '', bookings: 0, nights: 0, value: 0 };
          const nights = Math.round((Date.parse(String(booking.checkOut).slice(0, 10)) - Date.parse(String(booking.checkIn).slice(0, 10))) / 86_400_000);
          group.bookings += 1;
          group.nights += Number.isFinite(nights) ? nights : 0;
          group.value += Number(booking.totalAmount ?? 0);
          groups.set(key, group);
        }
        return {
          title: TITLES.demanda,
          columns: [
            { header: 'Ciudad', width: 20 },
            { header: 'Tipo de alojamiento', width: 20 },
            { header: 'Reservas confirmadas y completadas', width: 34, numFmt: INT, total: true },
            { header: 'Noches reservadas', width: 18, numFmt: INT, total: true },
            { header: 'Valor (COP)', width: 18, numFmt: COP, total: true },
          ],
          rows: [...groups.values()]
            .sort((a, b) => b.bookings - a.bookings || b.value - a.value || a.city.localeCompare(b.city, 'es'))
            .map((group) => [group.city, group.type, group.bookings, group.nights, group.value]),
        };
      }
    }
  }

  /** HU-058 CA1: genera el .xlsx y deja la exportación en la auditoría. */
  async export(report: string, filters: ExportReportQueryDto, actor?: string, now: Date = new Date()): Promise<ExportedReport> {
    if (!EXPORTABLE_REPORTS.includes(report as ExportableReport)) {
      throw new NotFoundException(`El reporte "${report}" no existe. Reportes disponibles: ${EXPORTABLE_REPORTS.join(', ')}`);
    }
    const table = this.buildTable(report as ExportableReport, filters);
    const buffer = await this.toWorkbook(table, filters, now);
    const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13);

    this.auditService.record({
      actor,
      action: AuditAction.EXPORT,
      entity: 'Report',
      entityId: report,
      result: AuditResult.EXITOSO,
      detail: `Exportó ${table.title.toLowerCase()} a Excel (${table.rows.length} filas). Filtros: ${describeFilters(filters)}`,
    });
    return { fileName: `stayhub-${report}-${stamp}.xlsx`, buffer, rows: table.rows.length };
  }

  /** HU-059 CA1, CA2: genera el .pdf con título, filtros, fecha, tabla y totales idénticos a los de Excel. */
  async exportPdf(report: string, filters: ExportReportQueryDto, actor?: string, now: Date = new Date()): Promise<ExportedReport> {
    if (!EXPORTABLE_REPORTS.includes(report as ExportableReport)) {
      throw new NotFoundException(`El reporte "${report}" no existe. Reportes disponibles: ${EXPORTABLE_REPORTS.join(', ')}`);
    }
    const table = this.buildTable(report as ExportableReport, filters);
    const buffer = await this.toPdf(table, filters, now);
    const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13);

    this.auditService.record({
      actor,
      action: AuditAction.EXPORT,
      entity: 'Report',
      entityId: report,
      result: AuditResult.EXITOSO,
      detail: `Exportó ${table.title.toLowerCase()} a PDF (${table.rows.length} filas). Filtros: ${describeFilters(filters)}`,
    });
    return { fileName: `stayhub-${report}-${stamp}.pdf`, buffer, rows: table.rows.length };
  }

  private async toWorkbook(table: ReportTable, filters: ExportReportQueryDto, now: Date): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'StayHub · Inversiones LR';
    workbook.created = now;
    const sheet = workbook.addWorksheet(table.title.replace('Reporte de ', '').slice(0, 31), {
      views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    });
    const lastColumn = table.columns.length;

    sheet.getCell(1, 1).value = table.title;
    sheet.getCell(1, 1).font = { bold: true, size: 14 };
    sheet.getCell(2, 1).value = generatedAtLabel(now);
    sheet.getCell(3, 1).value = `Filtros aplicados: ${describeFilters(filters)}`;

    table.columns.forEach((column, index) => {
      const cell = sheet.getCell(HEADER_ROW, index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D1D1F' } };
      sheet.getColumn(index + 1).width = column.width;
      if (column.numFmt) sheet.getColumn(index + 1).numFmt = column.numFmt;
    });
    sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastColumn } };

    table.rows.forEach((row, index) => {
      sheet.getRow(HEADER_ROW + 1 + index).values = row as never;
    });

    // CA2: fila de totales compartida con PDF (cantidad de filas y suma de las columnas numéricas).
    const totals = buildTotalRow(table);
    const totalRow = sheet.getRow(HEADER_ROW + table.rows.length + 2);
    totals.forEach((value, index) => {
      if (value !== null) totalRow.getCell(index + 1).value = value;
    });
    totalRow.font = { bold: true };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private toPdf(table: ReportTable, filters: ExportReportQueryDto, now: Date): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 32,
        compress: false,
        info: {
          Title: table.title,
          Author: 'StayHub · Inversiones LR',
          Subject: `Filtros aplicados: ${describeFilters(filters)}`,
          CreationDate: now,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const startX = 32;
      const usableWidth = doc.page.width - startX * 2;
      const totalWeight = table.columns.reduce((acc, col) => acc + col.width, 0) || 1;
      const colWidths = table.columns.map((col) => (col.width / totalWeight) * usableWidth);

      doc.font('Helvetica-Bold').fontSize(15).fillColor('#1d1d1f').text(table.title, startX, 32);
      doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(generatedAtLabel(now), startX, 52);
      doc.text(`Filtros aplicados: ${describeFilters(filters)}`, startX, 65);

      let y = 86;
      const rowHeight = 20;
      const drawRow = (cells: string[], opts: { header?: boolean; total?: boolean; zebra?: boolean } = {}) => {
        if (y + rowHeight > doc.page.height - 40) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
          y = 32;
        }
        if (opts.header) {
          doc.rect(startX, y, usableWidth, rowHeight).fill('#1d1d1f');
        } else if (opts.total) {
          doc.rect(startX, y, usableWidth, rowHeight).fill('#e5e7eb');
        } else if (opts.zebra) {
          doc.rect(startX, y, usableWidth, rowHeight).fill('#f9fafb');
        }
        doc
          .font(opts.header || opts.total ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8)
          .fillColor(opts.header ? '#ffffff' : '#1d1d1f');

        let x = startX;
        cells.forEach((text, index) => {
          const width = colWidths[index];
          if (text) {
            const cellWidth = opts.total && index === 0 ? Math.max(width, 180) : Math.max(20, width - 8);
            doc.text(text, x + 4, y + 6, { width: cellWidth, height: rowHeight - 6, lineBreak: false });
          }
          x += width;
        });
        y += rowHeight;
      };

      drawRow(
        table.columns.map((col) => col.header),
        { header: true },
      );

      table.rows.forEach((row, rowIndex) => {
        drawRow(
          row.map((cell) => formatPdfCell(cell)),
          { zebra: rowIndex % 2 === 1 },
        );
      });

      const totals = buildTotalRow(table);
      drawRow(
        totals.map((cell) => (cell === null ? '' : String(cell))),
        { total: true },
      );

      doc.end();
    });
  }
}

function generatedAtLabel(now: Date): string {
  return `Generado el ${bogotaDate(now)} ${new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(11, 16)} (hora de Colombia)`;
}

function formatPdfCell(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

/** Calcula la fila de totales compartida entre Excel y PDF (CA2). */
export function buildTotalRow(table: ReportTable): Array<string | number | null> {
  const row: Array<string | number | null> = table.columns.map((column, index) => {
    if (!column.total) return null;
    const sum = table.rows.reduce((acc, item) => acc + Number(item[index] ?? 0), 0);
    return Math.round(sum * 100) / 100;
  });
  row[0] = `Total: ${table.rows.length} fila(s)`;
  return row;
}

/** Extrae el texto renderizado en un PDF sin compresión generado por PDFKit (para pruebas de verificación). */
export function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.endsWith('TJ') && !line.endsWith('Tj')) continue;
    const parts = [...line.matchAll(/<([0-9a-fA-F]+)>/g)].map((match) => Buffer.from(match[1], 'hex').toString('latin1'));
    if (parts.length > 0) lines.push(parts.join(''));
  }
  return lines.join(' ');
}

/** Texto de los filtros aplicados que se escribe en el archivo y en la auditoría. */
export function describeFilters(filters: ExportReportQueryDto): string {
  const parts = [
    filters.from && `desde ${filters.from.slice(0, 10)}`,
    filters.to && `hasta ${filters.to.slice(0, 10)}`,
    filters.city && `ciudad ${filters.city}`,
    filters.status && `estado ${filters.status}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'ninguno (todos los registros)';
}
