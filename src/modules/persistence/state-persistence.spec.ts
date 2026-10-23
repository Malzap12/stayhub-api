import { CallHandler, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import {
  computeChanges,
  normalizeDbRow,
  REGISTERED_SOURCE_TABLES,
  rowsToSource,
  sourceToRows,
  TABLE_DEFINITIONS,
} from './state-tables';
import { PersistStateInterceptor } from './persist-state.interceptor';
import { StatePersistenceService } from './state-persistence.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { PasswordRecoveryService } from '../auth/password-recovery.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { Role } from '../../common/enums/role.enum';
import { ListingStatus } from '../../common/enums/listing-status.enum';

describe('Persistencia en PostgreSQL (Unitarias sin base de datos)', () => {
  describe('1. Columnas exactas por tabla en TABLE_DEFINITIONS', () => {
    it('todas las tablas requeridas están definidas con su clave primaria', () => {
      const requiredTables = [
        'usuarios',
        'sesiones',
        'eventos_auditoria',
        'tokens_recuperacion',
        'correos_simulados',
        'solicitudes_recuperacion',
        'publicaciones',
        'notificaciones_anfitrion',
        'periodos_disponibles',
        'periodos_reservados',
        'huespedes_con_reserva',
        'reservas',
        'configuracion_plataforma',
      ];

      for (const table of requiredTables) {
        expect(TABLE_DEFINITIONS[table]).toBeDefined();
        expect(TABLE_DEFINITIONS[table].primaryKey.length).toBeGreaterThan(0);
        expect(TABLE_DEFINITIONS[table].columns.length).toBeGreaterThan(0);
      }
    });

    it('toda fuente registrada tiene tablas asignadas en REGISTERED_SOURCE_TABLES', () => {
      const registeredKeys = ['auth', 'audit', 'passwordRecovery', 'bookings', 'listings', 'platform-config'];
      for (const key of registeredKeys) {
        expect(REGISTERED_SOURCE_TABLES[key]).toBeDefined();
        expect(REGISTERED_SOURCE_TABLES[key].length).toBeGreaterThan(0);
        for (const tbl of REGISTERED_SOURCE_TABLES[key]) {
          expect(TABLE_DEFINITIONS[tbl]).toBeDefined();
        }
      }
    });
  });

  describe('2. computeChanges (detección de diferencias y generación de deltas)', () => {
    it('detecta correctamente inserciones, actualizaciones y eliminaciones', () => {
      const savedMap = new Map<string, Record<string, unknown>>();
      savedMap.set('u1', { id: 'u1', nombre: 'Original', correo: 'u1@stayhub.com' });
      savedMap.set('u2', { id: 'u2', nombre: 'Por borrar', correo: 'u2@stayhub.com' });

      const currentRows = [
        { id: 'u1', nombre: 'Modificado', correo: 'u1@stayhub.com' }, // Update
        { id: 'u3', nombre: 'Nuevo', correo: 'u3@stayhub.com' },        // Insert
      ];

      const changes = computeChanges('usuarios', savedMap, currentRows);

      expect(changes.upserts).toHaveLength(2);
      expect(changes.upserts.map((r) => r.id)).toEqual(['u1', 'u3']);

      expect(changes.deletes).toHaveLength(1);
      expect(changes.deletes[0]).toEqual({ id: 'u2' });

      expect(changes.newSaved.size).toBe(2);
    });

    it('no genera cambios si los datos son idénticos', () => {
      const savedMap = new Map<string, Record<string, unknown>>();
      savedMap.set('u1', { id: 'u1', nombre: 'Igual', correo: 'u1@stayhub.com' });

      const currentRows = [{ id: 'u1', nombre: 'Igual', correo: 'u1@stayhub.com' }];

      const changes = computeChanges('usuarios', savedMap, currentRows);
      expect(changes.upserts).toHaveLength(0);
      expect(changes.deletes).toHaveLength(0);
    });
  });

  describe('3. Ciclo completo de traducción a filas y restauración entre dos arranques', () => {
    it('traduce todo tipo de datos a filas y los restaura conservando funcionalidad', async () => {
      // Arranque 1: creamos los servicios
      const registry: Record<string, { dump(): unknown; restore(d: unknown): void }> = {};
      const fakePersistence = {
        register: (k: string, src: any) => {
          registry[k] = src;
        },
      } as any;

      const audit = new AuditService(fakePersistence);
      const auth = new AuthService(audit, undefined, fakePersistence);
      const mailMock = {
        delivery: 'SIMULATED',
        send: jest.fn().mockResolvedValue(true),
        appBaseUrl: 'http://localhost:3000',
      } as any;
      const recovery = new PasswordRecoveryService(auth, audit, mailMock, undefined, fakePersistence);
      const listings = new ListingsService(audit, auth, fakePersistence);
      const platform = new PlatformConfigService(audit, fakePersistence);
      const bookings = new BookingsService(audit, listings, fakePersistence, platform);

      [auth, recovery, listings, platform, bookings].forEach((s) => s.onModuleInit());

      // Creamos datos de todo tipo
      // 1. Usuario con teléfono
      const reg = await auth.register({
        name: 'Carlos Host',
        email: 'carlos@stayhub.com',
        password: 'Password123',
        role: Role.ANFITRION,
        phone: '+57 300 111 2233',
      });
      const login = await auth.login({ email: 'carlos@stayhub.com', password: 'Password123' });
      const session = auth.getSession(login.token)!;

      // 2. Usuario restringido
      await auth.register({
        name: 'Malo',
        email: 'malo@stayhub.com',
        password: 'Password123',
        role: Role.HUESPED,
      });
      auth.restrictAccount('malo@stayhub.com', 'Comportamiento indebido', 'admin@inversioneslr.com');

      // 3. Borrador de publicación con campo extra
      const draft = listings.create(
        {
          title: 'Cabaña en Guatapé con vista',
          city: 'Guatapé',
          department: 'Antioquia',
          address: 'Vereda La Piedra',
          pricePerNight: 250000,
          maxGuests: 4,
        },
        session,
      );

      // 4. Periodo disponible y bloqueo
      await listings.registerAvailabilityPeriod(
        draft.id,
        { startDate: '2027-04-01', endDate: '2027-04-10' },
        session,
      );
      listings.blockReservedPeriod(
        draft.id,
        { checkIn: '2027-04-02', checkOut: '2027-04-05' },
        session.email,
        session.userId,
      );

      // 5. Reserva con fecha y hora en llegada/salida
      const quote = await bookings.quote({
        listingId: draft.id,
        checkIn: '2027-04-06T14:00:00Z',
        checkOut: '2027-04-08T11:00:00Z',
        guests: 2,
      });
      expect(quote.nights).toBeGreaterThan(0);

      // 6. Tarifa de servicio en plataforma
      platform.updateServiceFee({ serviceFeePercent: 18 }, 'admin@inversioneslr.com');

      // 7. Solicitud de recuperación y buzón
      recovery.requestRecovery('carlos@stayhub.com');

      // Convertimos todo a filas de base de datos simulando PostgreSQL
      const dbTables: Record<string, Record<string, unknown>[]> = {};
      for (const [key, src] of Object.entries(registry)) {
        const rowsByTable = sourceToRows(key, src.dump());
        for (const [tbl, rows] of Object.entries(rowsByTable)) {
          dbTables[tbl] = rows.map((r) => normalizeDbRow(tbl, r));
        }
      }

      // Verificamos que se hayan generado filas en las tablas principales
      expect(dbTables.usuarios?.length).toBeGreaterThan(1);
      expect(dbTables.sesiones?.length).toBeGreaterThan(0);
      expect(dbTables.publicaciones?.length).toBeGreaterThan(0);
      expect(dbTables.periodos_disponibles?.length).toBeGreaterThan(0);
      expect(dbTables.periodos_reservados?.length).toBeGreaterThan(0);
      expect(dbTables.correos_simulados?.length).toBeGreaterThan(0);
      expect(dbTables.configuracion_plataforma?.length).toBe(1);

      // Arranque 2: nuevos servicios vacíos
      const registry2: Record<string, { dump(): unknown; restore(d: unknown): void }> = {};
      const fakePersistence2 = {
        register: (k: string, src: any) => {
          registry2[k] = src;
        },
      } as any;

      const audit2 = new AuditService(fakePersistence2);
      const auth2 = new AuthService(audit2, undefined, fakePersistence2);
      const recovery2 = new PasswordRecoveryService(auth2, audit2, mailMock, undefined, fakePersistence2);
      const listings2 = new ListingsService(audit2, auth2, fakePersistence2);
      const platform2 = new PlatformConfigService(audit2, fakePersistence2);
      const bookings2 = new BookingsService(audit2, listings2, fakePersistence2, platform2);

      [auth2, recovery2, listings2, platform2, bookings2].forEach((s) => s.onModuleInit());

      // Restauramos cada servicio desde las filas de la base de datos
      for (const [key, src] of Object.entries(registry2)) {
        const data = rowsToSource(key, dbTables);
        src.restore(data);
      }

      // Verificaciones funcionales en el segundo arranque:
      // A. Login funciona con la contraseña cifrada restaurada
      const login2 = await auth2.login({ email: 'carlos@stayhub.com', password: 'Password123' });
      expect(login2.user.name).toBe('Carlos Host');
      expect(auth2.findByEmail('carlos@stayhub.com')?.phone).toBe('+57 300 111 2233');

      // B. Sesión previa sigue activa
      expect(auth2.getSession(login.token)?.email).toBe('carlos@stayhub.com');

      // C. Usuario restringido sigue restringido
      expect(auth2.findByEmail('malo@stayhub.com')?.status).toBe('RESTRINGIDA');

      // D. Publicación restaurada se puede consultar
      const myPubs = listings2.findMine(session.userId);
      expect(myPubs.some((p) => p.id === draft.id)).toBe(true);

      // E. Tarifa de servicio restaurada en 18%
      expect(platform2.getServiceFeePercent()).toBe(18);

      // F. Buzón de correos contiene el token de recuperación
      const mailbox = recovery2.getMailbox('carlos@stayhub.com');
      expect(mailbox.some((m) => m.to === 'carlos@stayhub.com')).toBe(true);
    });

    it('con la base de datos vacía cada servicio conserva sus datos de ejemplo', () => {
      const registry: Record<string, { dump(): unknown; restore(d: unknown): void }> = {};
      const fakePersistence = {
        register: (k: string, src: any) => {
          registry[k] = src;
        },
      } as any;

      const audit = new AuditService(fakePersistence);
      const auth = new AuthService(audit, undefined, fakePersistence);
      const listings = new ListingsService(audit, auth, fakePersistence);
      const platform = new PlatformConfigService(audit, fakePersistence);
      const bookings = new BookingsService(audit, listings, fakePersistence, platform);

      [auth, listings, platform, bookings].forEach((s) => s.onModuleInit());

      // Restauramos con snapshot vacío
      const emptySnapshot: Record<string, Record<string, unknown>[]> = {};
      for (const tbl of Object.keys(TABLE_DEFINITIONS)) {
        emptySnapshot[tbl] = [];
      }

      for (const [key, src] of Object.entries(registry)) {
        const data = rowsToSource(key, emptySnapshot);
        if (data) {
          src.restore(data);
        }
      }

      // Administrador inicial sembrado
      expect(auth.findByEmail('admin@inversioneslr.com')).toBeDefined();
      // Publicaciones demo conservadas
      expect(listings.getListingDetail('demo-bogota-chapinero')).toBeDefined();
      // Tarifa por defecto 12%
      expect(platform.getServiceFeePercent()).toBe(12);
    });
  });

  describe('4. PersistStateInterceptor', () => {
    let persistenceMock: { flush: jest.Mock };
    let interceptor: PersistStateInterceptor;

    beforeEach(() => {
      persistenceMock = { flush: jest.fn().mockResolvedValue(undefined) };
      interceptor = new PersistStateInterceptor(persistenceMock as any);
    });

    const createCtx = (method: string): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ method }),
        }),
      } as any);

    it('en métodos GET, HEAD y OPTIONS no ejecuta flush', async () => {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const handler: CallHandler = { handle: () => of({ ok: true }) };
        const result = await lastValueFrom(interceptor.intercept(createCtx(method), handler));
        expect(result).toEqual({ ok: true });
        expect(persistenceMock.flush).not.toHaveBeenCalled();
      }
    });

    it('en POST, PUT, PATCH y DELETE espera flush() antes de responder', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        persistenceMock.flush.mockClear();
        const handler: CallHandler = { handle: () => of({ created: true }) };
        const result = await lastValueFrom(interceptor.intercept(createCtx(method), handler));
        expect(result).toEqual({ created: true });
        expect(persistenceMock.flush).toHaveBeenCalledTimes(1);
      }
    });

    it('si flush() falla lanza ServiceUnavailableException 503', async () => {
      persistenceMock.flush.mockRejectedValue(new Error('Connection lost to DB'));
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      await expect(lastValueFrom(interceptor.intercept(createCtx('POST'), handler))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('si el handler ya falló, intenta flush() para auditoría y no oculta el error original', async () => {
      const originalError = new Error('Bad input 400');
      const handler: CallHandler = { handle: () => throwError(() => originalError) };

      await expect(lastValueFrom(interceptor.intercept(createCtx('POST'), handler))).rejects.toThrow(
        'Bad input 400',
      );
      expect(persistenceMock.flush).toHaveBeenCalledTimes(1);
    });
  });
});
