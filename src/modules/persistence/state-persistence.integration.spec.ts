import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StatePersistenceService } from './state-persistence.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { createDataSourceOptions } from './database.config';

const describeIfDb = process.env.TEST_DATABASE_HOST ? describe : describe.skip;

describeIfDb('Persistencia en PostgreSQL (Integración con base de datos real)', () => {
  // Usan una base real: con varias suites en paralelo una operación puede tardar más de los 5 s por defecto.
  jest.setTimeout(30_000);

  let schemaName: string;
  let dataSource: DataSource;
  const originalEnv = { ...process.env };

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
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
      await dataSource.destroy();
    }
    process.env = { ...originalEnv };
  });

  const createBootInstance = async () => {
    const persistence = new StatePersistenceService();
    const audit = new AuditService(persistence);
    const auth = new AuthService(audit, undefined, persistence);
    const listings = new ListingsService(audit, auth, persistence);
    const platform = new PlatformConfigService(audit, persistence);
    const bookings = new BookingsService(audit, listings, persistence, platform);

    [auth, listings, platform, bookings].forEach((s) => s.onModuleInit());
    await persistence.onApplicationBootstrap();

    return { persistence, audit, auth, listings, platform, bookings };
  };

  it('1. ejecuta migraciones y guarda datos de ejemplo en el primer arranque', async () => {
    const inst = await createBootInstance();
    const rows = await dataSource.query(`SELECT COUNT(*) FROM "${schemaName}"."publicaciones";`);
    expect(parseInt(rows[0].count, 10)).toBeGreaterThan(0);
    await inst.persistence.onApplicationShutdown();
  });

  it('2. guarda y recupera datos en un nuevo arranque', async () => {
    const inst1 = await createBootInstance();
    await inst1.auth.register({
      name: 'Usuario Persistido',
      email: 'persistido@stayhub.com',
      password: 'Password123',
      role: Role.HUESPED,
    });
    await inst1.persistence.flush();
    await inst1.persistence.onApplicationShutdown();

    const inst2 = await createBootInstance();
    const user = inst2.auth.findByEmail('persistido@stayhub.com');
    expect(user).toBeDefined();
    expect(user?.name).toBe('Usuario Persistido');
    await inst2.persistence.onApplicationShutdown();
  });

  it('3. solo escribe en la base de datos si hay cambios (no-op)', async () => {
    const inst = await createBootInstance();
    const querySpy = jest.spyOn((inst.persistence as any).dataSource, 'createQueryRunner');
    querySpy.mockClear();

    // Sin cambios
    await inst.persistence.flush();
    expect(querySpy).not.toHaveBeenCalled();

    await inst.persistence.onApplicationShutdown();
  });

  it('4. UPDATE o DELETE sobre la tabla eventos_auditoria falla por el trigger de inmutabilidad', async () => {
    const events = await dataSource.query(`SELECT id FROM "${schemaName}"."eventos_auditoria" LIMIT 1;`);
    if (events.length > 0) {
      const eventId = events[0].id;
      await expect(
        dataSource.query(`UPDATE "${schemaName}"."eventos_auditoria" SET actor = 'hacker' WHERE id = '${eventId}';`),
      ).rejects.toThrow(/inmutables/);

      await expect(
        dataSource.query(`DELETE FROM "${schemaName}"."eventos_auditoria" WHERE id = '${eventId}';`),
      ).rejects.toThrow(/inmutables/);
    }
  });

  it('5. soporta 5 guardados simultáneos en cola sin colisión', async () => {
    const inst = await createBootInstance();
    const promises = Array.from({ length: 5 }).map((_, i) => {
      inst.platform.updateServiceFee({ serviceFeePercent: 10 + i }, `admin${i}@inversioneslr.com`);
      return inst.persistence.flush();
    });

    await Promise.all(promises);
    expect(inst.platform.getServiceFeePercent()).toBe(14);
    await inst.persistence.onApplicationShutdown();
  });

  it('6. persiste cambios de estado de una publicación y tarifa de servicio', async () => {
    const inst = await createBootInstance();
    inst.platform.updateServiceFee({ serviceFeePercent: 22 }, 'admin@inversioneslr.com');
    await inst.persistence.flush();
    await inst.persistence.onApplicationShutdown();

    const instReboot = await createBootInstance();
    expect(instReboot.platform.getServiceFeePercent()).toBe(22);
    await instReboot.persistence.onApplicationShutdown();
  });

  it('7. una reserva de huésped se guarda y, tras reiniciar, el huésped sigue viendo la publicación pausada (HU-026)', async () => {
    const inst1 = await createBootInstance();
    await inst1.auth.register({ name: 'Huésped con reserva', email: 'reserva.pg@stayhub.com', password: 'Password123', role: Role.HUESPED });
    const { token } = await inst1.auth.login({ email: 'reserva.pg@stayhub.com', password: 'Password123' });
    const guest = inst1.auth.getSession(token)!;

    inst1.listings.blockReservedPeriod('demo-bogota-pausada', { checkIn: '2026-12-10', checkOut: '2026-12-12' }, guest.email, guest.userId);
    await expect(inst1.persistence.flush()).resolves.toBeUndefined();

    const rows = await dataSource.query(`SELECT publicacion_id, usuario_id FROM "${schemaName}"."huespedes_con_reserva";`);
    expect(rows).toEqual([{ publicacion_id: 'demo-bogota-pausada', usuario_id: guest.userId }]);
    await inst1.persistence.onApplicationShutdown();

    const inst2 = await createBootInstance();
    expect(inst2.listings.getListingDetail('demo-bogota-pausada', `Bearer ${token}`).status).toBe(ListingStatus.PAUSADA);
    await inst2.persistence.onApplicationShutdown();
  });

  it('8. si la base rechaza un cambio, lo no guardado se descarta y los siguientes guardados funcionan', async () => {
    const inst = await createBootInstance();
    const listings = inst.listings as unknown as {
      availabilityPeriodsStore: Array<Record<string, unknown>>;
      listingsStore: Array<{ id: string }>;
    };
    // Una publicación nueva sin guardar y un periodo de una publicación que no existe (lo rechaza la llave foránea).
    const draft = inst.listings.create({ title: 'Borrador no guardado' }, {
      token: 't', userId: 'host-x', email: 'x@stayhub.com', role: Role.ANFITRION, expiresAt: Date.now() + 60_000,
    });
    listings.availabilityPeriodsStore.push({
      id: 'periodo-huerfano', listingId: 'no-existe', startDate: '2027-01-01', endDate: '2027-01-05', availableForBooking: true, createdAt: new Date(),
    });

    await expect(inst.persistence.flush()).rejects.toThrow();
    expect(listings.availabilityPeriodsStore.some((p) => p.id === 'periodo-huerfano')).toBe(false);
    expect(listings.listingsStore.some((l) => l.id === draft.id)).toBe(false);

    await inst.auth.register({ name: 'Tras el error', email: 'tras.error.pg@stayhub.com', password: 'Password123', role: Role.HUESPED });
    await expect(inst.persistence.flush()).resolves.toBeUndefined();
    await inst.persistence.onApplicationShutdown();
  });
});
