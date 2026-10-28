import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { ReportsService } from './reports.service';
import { createDataSourceOptions } from '../persistence/database.config';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { ListingResponseDto } from '../listings/dto/listing-response.dto';

const describeIfDb = process.env.TEST_DATABASE_HOST ? describe : describe.skip;

/**
 * HU-056 CA2 · Con un conjunto de datos de prueba conocido guardado en PostgreSQL, cada indicador del dashboard
 * coincide con una consulta directa a las tablas usuarios, publicaciones y reservas.
 */
describeIfDb('HU-056 CA2 · Los indicadores coinciden con una consulta directa a PostgreSQL', () => {
  jest.setTimeout(30_000);

  let schemaName: string;
  let dataSource: DataSource;
  let persistence: StatePersistenceService;
  let reports: ReportsService;
  const originalEnv = { ...process.env };
  const q = async (sql: string) => dataSource.query(sql.replace(/\$schema/g, `"${schemaName}"`));

  beforeAll(async () => {
    schemaName = `stayhub_prueba_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    process.env.DATABASE_SCHEMA = schemaName;
    process.env.DATABASE_HOST = process.env.TEST_DATABASE_HOST;
    process.env.DATABASE_PORT = process.env.TEST_DATABASE_PORT ?? '5432';
    process.env.DATABASE_USER = process.env.TEST_DATABASE_USER ?? 'lr_user';
    process.env.DATABASE_PASSWORD = process.env.TEST_DATABASE_PASSWORD ?? 'lr_password123';
    process.env.DATABASE_NAME = process.env.TEST_DATABASE_NAME ?? 'inversiones_lr_db';
    process.env.PERSIST_STATE = 'true';
    delete process.env.NODE_ENV;

    dataSource = new DataSource(createDataSourceOptions(schemaName));
    await dataSource.initialize();

    persistence = new StatePersistenceService();
    const audit = new AuditService(persistence);
    const auth = new AuthService(audit, undefined, persistence);
    const listings = new ListingsService(audit, auth, persistence);
    const platform = new PlatformConfigService(audit, persistence);
    const bookings = new BookingsService(audit, listings, persistence, platform);
    [auth, listings, platform, bookings].forEach((service) => service.onModuleInit());
    await persistence.onApplicationBootstrap();
    reports = new ReportsService(auth, listings, bookings);

    // Conjunto de datos de prueba conocido, sumado a los datos de ejemplo del primer arranque.
    for (const [email, role] of [
      ['h1.hu056@prueba.com', Role.HUESPED], ['h2.hu056@prueba.com', Role.HUESPED], ['a1.hu056@prueba.com', Role.ANFITRION],
    ] as Array<[string, Role]>) {
      await auth.register({ name: email, email, password: 'Password123', role } as never);
    }
    const store = (listings as unknown as { listingsStore: ListingResponseDto[] }).listingsStore;
    const base = store[0];
    store.push(
      { ...base, id: 'hu056-pasto', city: 'Pasto', status: ListingStatus.ACTIVA },
      { ...base, id: 'hu056-tunja', city: 'Tunja', status: ListingStatus.BLOQUEADA },
    );
    const bookingStore = (bookings as unknown as { bookingsStore: BookingResponseDto[] }).bookingsStore;
    let seq = 0;
    const add = (listingId: string, status: BookingStatus, totalAmount: number, serviceFee: number) =>
      bookingStore.push({
        id: `hu056-${++seq}`, listingId, guestId: 'h1.hu056@prueba.com', checkIn: '2026-11-01', checkOut: '2026-11-03', guests: 2,
        totalAmount, serviceFee, currency: 'COP', status, idempotencyKey: `hu056-${seq}`, createdAt: new Date(),
      });
    for (let i = 0; i < 6; i++) add('hu056-pasto', BookingStatus.CONFIRMADA, 250_000, 25_000);
    add('hu056-pasto', BookingStatus.COMPLETADA, 400_000.5, 40_000.25);
    add('hu056-tunja', BookingStatus.COMPLETADA, 300_000, 30_000);
    add('hu056-tunja', BookingStatus.CANCELADA, 999_000, 99_000);
    add('hu056-tunja', BookingStatus.EN_REVISION, 120_000, 12_000);
    add('hu056-pasto', BookingStatus.PENDIENTE, 80_000, 8_000);

    await persistence.flush();
  });

  afterAll(async () => {
    await persistence?.onApplicationShutdown();
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
      await dataSource.destroy();
    }
    process.env = { ...originalEnv };
  });

  it('usuarios por rol = SELECT rol, COUNT(*) FROM usuarios GROUP BY rol', async () => {
    const rows: Array<{ rol: string; n: string }> = await q('SELECT rol, COUNT(*) AS n FROM $schema.usuarios GROUP BY rol');
    const expected = { HUESPED: 0, ANFITRION: 0, ADMINISTRADOR: 0, total: 0 };
    rows.forEach((row) => {
      expected[row.rol as Role] = Number(row.n);
      expected.total += Number(row.n);
    });

    expect(reports.getDashboard().usersByRole).toEqual(expected);
    expect(expected.HUESPED).toBeGreaterThanOrEqual(2);
  });

  it("publicaciones ACTIVAS = SELECT COUNT(*) FROM publicaciones WHERE estado = 'ACTIVA'", async () => {
    const [row] = await q(`SELECT COUNT(*) AS n FROM $schema.publicaciones WHERE estado = 'ACTIVA'`);
    expect(reports.getDashboard().activeListings).toBe(Number(row.n));
  });

  it('reservas por estado = SELECT estado, COUNT(*) FROM reservas GROUP BY estado', async () => {
    const rows: Array<{ estado: string; n: string }> = await q('SELECT estado, COUNT(*) AS n FROM $schema.reservas GROUP BY estado');
    const expected = { PENDIENTE: 0, CONFIRMADA: 0, CANCELADA: 0, COMPLETADA: 0, EN_REVISION: 0, total: 0 };
    rows.forEach((row) => {
      expected[row.estado as BookingStatus] = Number(row.n);
      expected.total += Number(row.n);
    });

    expect(reports.getDashboard().bookingsByStatus).toEqual(expected);
  });

  it('ingresos estimados = SUM(total) y SUM(tarifa_servicio) de reservas CONFIRMADA y COMPLETADA en COP', async () => {
    const [row] = await q(`
      SELECT COALESCE(SUM(total), 0) AS valor, COALESCE(SUM(tarifa_servicio), 0) AS tarifa, COUNT(*) AS n
      FROM $schema.reservas WHERE estado IN ('CONFIRMADA', 'COMPLETADA') AND moneda = 'COP'`);

    expect(reports.getDashboard().estimatedRevenue).toEqual({
      currency: 'COP',
      grossBookingValue: Number(row.valor),
      platformFees: Number(row.tarifa),
      bookings: Number(row.n),
    });
  });

  it('las 5 ciudades = reservas CONFIRMADA y COMPLETADA unidas a publicaciones, agrupadas por ciudad', async () => {
    const rows: Array<{ ciudad: string; n: string; valor: string }> = await q(`
      SELECT p.ciudad, COUNT(*) AS n, SUM(r.total) AS valor
      FROM $schema.reservas r JOIN $schema.publicaciones p ON p.id = r.publicacion_id
      WHERE r.estado IN ('CONFIRMADA', 'COMPLETADA') AND r.moneda = 'COP'
      GROUP BY p.ciudad ORDER BY n DESC, valor DESC, p.ciudad LIMIT 5`);

    expect(reports.getDashboard().topCities).toEqual(
      rows.map((row) => ({ city: row.ciudad, bookings: Number(row.n), grossBookingValue: Number(row.valor) })),
    );
    expect([rows[0].ciudad, Number(rows[0].n)]).toEqual(['Pasto', 7]);
  });
});
