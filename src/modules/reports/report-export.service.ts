import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { AuthService } from '../auth/auth.service';
import { BookingsService, bogotaDate } from '../bookings/bookings.service';
import { ListingsService, normalizeCity } from '../listings/listings.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { REVENUE_CURRENCY, REVENUE_STATUSES } from './reports.service';
import { EXPORTABLE_REPORTS, ExportableReport, ExportReportQueryDto } from './dto/export-report.dto';

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
 * HU-058 · Exportar reportes a Excel (CA1, CA2 · RF-076, RF-077, RN-026).
 * Cinco reportes (AMB-23): usuarios, publicaciones, reservas, ingresos estimados y demanda por ciudad y tipo.
 * Cada archivo .xlsx trae título, fecha de generación, filtros aplicados, encabezados con autofiltro y una fila de
 * totales calculada con los mismos datos que el dashboard (HU-056), por lo que coinciden con el sistema (CA2).
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

  /** CA1: genera el .xlsx y deja la exportación en la auditoría. */
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
    sheet.getCell(2, 1).value = `Generado el ${bogotaDate(now)} ${new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(11, 16)} (hora de Colombia)`;
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

    // CA2: fila de totales (cantidad de filas y suma de las columnas numéricas).
    const totalRow = sheet.getRow(HEADER_ROW + table.rows.length + 2);
    totalRow.getCell(1).value = `Total: ${table.rows.length} fila(s)`;
    table.columns.forEach((column, index) => {
      if (!column.total) return;
      const sum = table.rows.reduce((acc, row) => acc + Number(row[index] ?? 0), 0);
      totalRow.getCell(index + 1).value = Math.round(sum * 100) / 100;
    });
    totalRow.font = { bold: true };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
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
