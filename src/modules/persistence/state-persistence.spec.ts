import { CallHandler, ExecutionContext } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastValueFrom, of } from 'rxjs';
import { deserializeState, serializeState, StatePersistenceService } from './state-persistence.service';
import { PersistStateInterceptor } from './persist-state.interceptor';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { AuditAction } from '../../common/enums/audit.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';

describe('Persistencia de los datos del API en un archivo (volumen de Docker)', () => {
  let dir: string;
  let file: string;
  const originalEnv = { ...process.env };

  /** Simula un arranque del API con persistencia activa sobre el mismo archivo. */
  const boot = () => {
    const persistence = new StatePersistenceService();
    const audit = new AuditService(persistence);
    const auth = new AuthService(audit, undefined, persistence);
    const listings = new ListingsService(audit, auth, persistence);
    const bookings = new BookingsService(audit, listings, persistence);
    [auth, listings, bookings].forEach((service) => service.onModuleInit());
    return { persistence, audit, auth, listings, bookings };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'stayhub-estado-'));
    file = join(dir, 'datos', 'estado.json');
    process.env.DATA_FILE = file;
    process.env.NODE_ENV = 'development';
    delete process.env.PERSIST_STATE;
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
    rmSync(dir, { recursive: true, force: true });
  });

  it('conserva las fechas como Date al guardar y leer', () => {
    const date = new Date('2026-10-22T15:30:00.000Z');
    const restored = deserializeState(serializeState({ item: { createdAt: date, day: '2026-11-10' } }));

    expect((restored.item as { createdAt: Date }).createdAt).toEqual(date);
    expect((restored.item as { day: string }).day).toBe('2026-11-10');
  });

  it('tras "reiniciar" el API se conservan usuarios, sesiones, publicaciones, periodos, reservas y auditoría', async () => {
    const first = boot();
    await first.auth.register({ name: 'Ana Anfitriona', email: 'ana@stayhub.com', password: 'Password123', role: Role.ANFITRION });
    const { token } = await first.auth.login({ email: 'ana@stayhub.com', password: 'Password123' });
    const session = first.auth.getSession(token)!;
    const listing = first.listings.create({ title: 'Cabaña guardada', city: 'Guatapé' }, session);
    first.listings.blockReservedPeriod('demo-bogota-chapinero', { checkIn: '2026-12-10', checkOut: '2026-12-12' }, 'h@x.com', 'user-9');
    first.persistence.onApplicationShutdown();

    expect(existsSync(file)).toBe(true);

    const second = boot();
    expect(second.auth.findByEmail('ana@stayhub.com')?.name).toBe('Ana Anfitriona');
    expect(second.auth.getSession(token)?.userId).toBe(session.userId);
    const mine = second.listings.findMine(session.userId);
    expect(mine.map((item) => item.id)).toEqual([listing.id]);
    expect(mine[0].createdAt).toBeInstanceOf(Date);
    expect(second.listings.getReservedPeriods('demo-bogota-chapinero')).toHaveLength(1);
    expect(second.audit.findAll({ action: AuditAction.REGISTER }).some((e) => e.actor === 'ana@stayhub.com')).toBe(true);
    expect(second.auth.getAdmins()).toHaveLength(1);
  });

  it('los nuevos usuarios siguen numerándose después de los recuperados', async () => {
    const first = boot();
    const { user } = await first.auth.register({ name: 'Uno', email: 'uno@stayhub.com', password: 'Password123', role: Role.HUESPED });
    first.persistence.save();

    const second = boot();
    const { user: next } = await second.auth.register({ name: 'Dos', email: 'dos@stayhub.com', password: 'Password123', role: Role.HUESPED });
    expect(next.id).not.toBe(user.id);
  });

  it('agrega las publicaciones de ejemplo nuevas que no estaban en el archivo', () => {
    const first = boot();
    first.persistence.save();
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    saved.listings.listings = saved.listings.listings.filter((item: { id: string }) => item.id !== 'demo-salento-cabana');
    writeFileSync(file, JSON.stringify(saved));

    const second = boot();
    expect(second.listings.getListingDetail('demo-salento-cabana').status).toBe(ListingStatus.ACTIVA);
  });

  it('agrupa varios cambios en una sola escritura', () => {
    const { persistence } = boot();
    const save = jest.spyOn(persistence, 'save');

    persistence.scheduleSave();
    persistence.scheduleSave();
    persistence.scheduleSave();
    jest.advanceTimersByTime(300);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('si el archivo está dañado arranca con los datos de ejemplo', () => {
    boot().persistence.save();
    writeFileSync(file, '{ esto no es json');

    const { auth, listings } = boot();
    expect(auth.getAdmins()).toHaveLength(1);
    expect(listings.getListingDetail('demo-bogota-chapinero').title).toBe('Apartamento en Chapinero Alto');
  });

  it('en pruebas o con PERSIST_STATE=false no lee ni escribe el disco', () => {
    process.env.PERSIST_STATE = 'false';
    const { persistence } = boot();
    persistence.save();
    persistence.scheduleSave();

    expect(persistence.enabled).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  describe('PersistStateInterceptor', () => {
    const contextFor = (method: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ method }) }) }) as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('respuesta') };

    it('programa el guardado tras POST, PUT, PATCH y DELETE, pero no tras GET', async () => {
      const persistence = { scheduleSave: jest.fn() } as unknown as StatePersistenceService;
      const interceptor = new PersistStateInterceptor(persistence);

      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        await lastValueFrom(interceptor.intercept(contextFor(method), handler));
      }
      await lastValueFrom(interceptor.intercept(contextFor('GET'), handler));

      expect(persistence.scheduleSave).toHaveBeenCalledTimes(4);
    });
  });
});
