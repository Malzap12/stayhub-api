import { CallHandler, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import {
  computeChanges,
  normalizeDbRow,
  REGISTERED_SOURCE_TABLES,
  rowsToSource,
  serializePkValue,
  sourceToRows,
  stableJson,
  TABLE_DEFINITIONS,
  toDateOnly,
  toIso,
} from './state-tables';
import {
  createDataSourceOptions,
  getDatabaseSchema,
  isPersistenceEnabled,
  validateSchemaName,
} from './database.config';
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

  describe('5. database.config: validaciones y opciones', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('validateSchemaName valida formato seguro y rechaza cadenas inválidas', () => {
      expect(validateSchemaName('stayhub')).toBe('stayhub');
      expect(validateSchemaName('  STAYHUB_01  ')).toBe('stayhub_01');

      expect(() => validateSchemaName('')).toThrow();
      expect(() => validateSchemaName('123abc')).toThrow();
      expect(() => validateSchemaName('stay-hub')).toThrow();
      expect(() => validateSchemaName('schema; drop table')).toThrow();
    });

    it('getDatabaseSchema retorna el valor configurado o el por defecto', () => {
      delete process.env.DATABASE_SCHEMA;
      expect(getDatabaseSchema()).toBe('stayhub');

      process.env.DATABASE_SCHEMA = 'mi_esquema';
      expect(getDatabaseSchema()).toBe('mi_esquema');
    });

    it('isPersistenceEnabled respeta NODE_ENV=test y PERSIST_STATE=false', () => {
      process.env.NODE_ENV = 'test';
      expect(isPersistenceEnabled()).toBe(false);

      delete process.env.NODE_ENV;
      process.env.PERSIST_STATE = 'false';
      expect(isPersistenceEnabled()).toBe(false);

      process.env.PERSIST_STATE = 'true';
      expect(isPersistenceEnabled()).toBe(true);
    });

    it('createDataSourceOptions configura SSL y esquema personalizado', () => {
      process.env.DATABASE_SSL = 'true';
      const opts = createDataSourceOptions('esquema_custom') as any;
      expect(opts.schema).toBe('esquema_custom');
      expect(opts.ssl).toEqual({ rejectUnauthorized: false });
      expect(opts.migrationsTableName).toBe('migraciones');
    });
  });

  describe('6. state-tables: serialización y normalización', () => {
    it('serializePkValue maneja null, undefined, primitivos y objetos', () => {
      expect(serializePkValue(null)).toBe('');
      expect(serializePkValue(undefined)).toBe('');
      expect(serializePkValue(123)).toBe('123');
      expect(serializePkValue('token-abc')).toBe('token-abc');
      expect(serializePkValue({ id: 1 })).toBe('{"id":1}');
    });

    it('stableJson genera JSON canónico determinista', () => {
      expect(stableJson(null)).toBe('null');
      expect(stableJson(42)).toBe('42');
      expect(stableJson([1, 2])).toBe('[1,2]');
      expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    });

    it('normalizeDbRow maneja tablas desconocidas y Date objects', () => {
      const raw = { foo: 'bar' };
      expect(normalizeDbRow('tabla_inexistente', raw)).toBe(raw);

      const d = new Date('2026-10-23T00:00:00.000Z');
      const normalizedUser = normalizeDbRow('usuarios', {
        id: 'user-1',
        creado_en: d,
      });
      expect(normalizedUser.creado_en).toBe(d.toISOString());
    });

    it('computeChanges detecta eliminaciones correctamente', () => {
      const savedMap = new Map<string, Record<string, unknown>>();
      savedMap.set('u1', { id: 'u1', nombre: 'Uno' });
      savedMap.set('u2', { id: 'u2', nombre: 'Dos' });

      // u2 fue eliminado de las filas actuales
      const currentRows = [{ id: 'u1', nombre: 'Uno' }];
      const changes = computeChanges('usuarios', savedMap, currentRows);

      expect(changes.deletes).toHaveLength(1);
      expect(changes.deletes[0].id).toBe('u2');
      expect(changes.upserts).toHaveLength(0);
    });

    it('toIso y toDateOnly formatean fechas y manejan casos inválidos o nulos', () => {
      expect(toIso(null)).toBeNull();
      expect(toIso(123)).toBeNull();
      const d = new Date('2026-10-23T12:00:00Z');
      expect(toIso(d)).toBe(d.toISOString());
      expect(toIso('2026-10-23T12:00:00Z')).toBe('2026-10-23T12:00:00.000Z');
      expect(toIso('fecha-invalida')).toBe('fecha-invalida');

      expect(toDateOnly(null)).toBeNull();
      expect(toDateOnly(123)).toBeNull();
      expect(toDateOnly('2026-10-23T12:00:00Z')).toBe('2026-10-23');
      expect(toDateOnly(d)).toBe('2026-10-23');
    });

    it('normalizeDbRow maneja jsonb en formato string y strings no parseables', () => {
      const parsed = normalizeDbRow('publicaciones', {
        descuento_estancia: '{"semanal":10}',
      });
      expect(parsed.descuento_estancia).toEqual({ semanal: 10 });

      const invalidJson = normalizeDbRow('publicaciones', {
        descuento_estancia: '{no-es-json',
      });
      expect(invalidJson.descuento_estancia).toBe('{no-es-json');
    });

    it('sourceToRows y rowsToSource manejan claves desconocidas y notificaciones de anfitrión', () => {
      expect(sourceToRows('clave_desconocida', {})).toEqual({});
      expect(rowsToSource('clave_desconocida', {})).toBeNull();
      expect(() => computeChanges('tabla_inexistente', new Map(), [])).toThrow();

      const dumped = sourceToRows('listings', {
        listings: [],
        availabilityPeriods: [],
        reservedPeriods: [],
        guestsWithReservations: [],
        hostNotifications: [
          { id: 'notif-1', listingId: 'l1', hostId: 'h1', type: 'INFO', message: 'hola', createdAt: new Date() },
        ],
      });
      expect(dumped.notificaciones_anfitrion).toHaveLength(1);

      const restored: any = rowsToSource('listings', {
        notificaciones_anfitrion: [
          { id: 'notif-1', publicacion_id: 'l1', anfitrion_id: 'h1', tipo: 'INFO', mensaje: 'hola' },
        ],
      });
      expect(restored.hostNotifications).toHaveLength(1);
    });
  });

  describe('7. StatePersistenceService: ciclo de vida y flush transaccional', () => {
    it('onApplicationBootstrap no hace nada si enabled es false', async () => {
      const service = new StatePersistenceService();
      (service as any).enabled = false;
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('onApplicationShutdown limpia timer, ejecuta flush y destruye la conexion', async () => {
      const service = new StatePersistenceService();
      const flushSpy = jest.spyOn(service, 'flush').mockRejectedValue(new Error('flush failed'));
      (service as any).periodicTimer = setInterval(() => {}, 100_000);
      const destroyMock = jest.fn().mockResolvedValue(undefined);
      (service as any).dataSource = {
        isInitialized: true,
        destroy: destroyMock,
      };

      await service.onApplicationShutdown();
      expect(flushSpy).toHaveBeenCalled();
      expect(destroyMock).toHaveBeenCalled();
    });

    it('resync restaura fuentes desde memoria', () => {
      const service = new StatePersistenceService();
      const mockSource = { dump: jest.fn(), restore: jest.fn() };
      service.register('auth', mockSource);

      service.resync();
      expect(mockSource.restore).toHaveBeenCalled();
    });

    it('flush ejecuta transacción con queries de delete y upsert', async () => {
      const service = new StatePersistenceService();
      (service as any).enabled = true;

      const mockQueries: string[] = [];
      const queryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockImplementation((sql: string) => {
          mockQueries.push(sql);
          return Promise.resolve([]);
        }),
      };

      (service as any).dataSource = {
        isInitialized: true,
        createQueryRunner: () => queryRunner,
      };

      // Simulamos estado previo con 1 usuario
      const initialMap = new Map<string, Record<string, unknown>>();
      initialMap.set('user-old', { id: 'user-old', nombre: 'Viejo', correo: 'v@s.com' });
      (service as any).saved.set('usuarios', initialMap);

      // Fuente actual con 1 usuario nuevo (user-old eliminado, user-new insertado)
      service.register('auth', {
        dump: () => ({
          users: [
            ['user-new', { id: 'user-new', name: 'Nuevo', email: 'n@s.com', role: Role.HUESPED, status: 'ACTIVA' }],
          ],
          sessions: [],
        }),
        restore: jest.fn(),
      });

      await service.flush();

      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueries.some((q) => q.includes('DELETE FROM'))).toBe(true);
      expect(mockQueries.some((q) => q.includes('INSERT INTO'))).toBe(true);
    });

    it('flush hace rollback y resync si la base de datos lanza error', async () => {
      const service = new StatePersistenceService();
      (service as any).enabled = true;

      const queryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockRejectedValue(new Error('PostgreSQL write failed')),
      };

      (service as any).dataSource = {
        isInitialized: true,
        createQueryRunner: () => queryRunner,
      };

      service.register('auth', {
        dump: () => ({
          users: [['user-1', { id: 'user-1', name: 'Error', email: 'e@s.com', role: Role.HUESPED, status: 'ACTIVA' }]],
          sessions: [],
        }),
        restore: jest.fn(),
      });

      await expect(service.flush()).rejects.toThrow('PostgreSQL write failed');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('onApplicationBootstrap inicializa conexión, corre migraciones y carga tablas', async () => {
      const service = new StatePersistenceService();
      (service as any).enabled = true;

      const mockDataSource = {
        isInitialized: true,
        initialize: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('SELECT * FROM')) return Promise.resolve([{ id: 'admin-1', orden: 1 }]);
          return Promise.resolve([]);
        }),
        showMigrations: jest.fn().mockResolvedValue(true),
        runMigrations: jest.fn().mockResolvedValue([{ name: 'Migracion1' }]),
        createQueryRunner: () => ({
          connect: jest.fn().mockResolvedValue(undefined),
          startTransaction: jest.fn().mockResolvedValue(undefined),
          commitTransaction: jest.fn().mockResolvedValue(undefined),
          rollbackTransaction: jest.fn().mockResolvedValue(undefined),
          release: jest.fn().mockResolvedValue(undefined),
          query: jest.fn().mockResolvedValue([]),
        }),
      };

      jest.spyOn(service as any, 'connectWithRetries').mockImplementation(async () => {
        (service as any).dataSource = mockDataSource;
      });

      await service.onApplicationBootstrap();

      expect(mockDataSource.query).toHaveBeenCalledWith(expect.stringContaining('CREATE SCHEMA IF NOT EXISTS'));
      expect(mockDataSource.runMigrations).toHaveBeenCalled();
      if ((service as any).periodicTimer) {
        clearInterval((service as any).periodicTimer);
      }
    });

    it('onApplicationBootstrap registra advertencia si una fuente no tiene tablas configuradas', async () => {
      const service = new StatePersistenceService();
      (service as any).enabled = true;
      service.register('fuente_desconocida', { dump: () => ({}), restore: jest.fn() });
      jest.spyOn(service as any, 'connectWithRetries').mockImplementation(async () => {});

      await service.onApplicationBootstrap();
    });

    it('connectWithRetries lanza error tras agotar reintentos si no conecta', async () => {
      const service = new StatePersistenceService();
      const origPort = process.env.DATABASE_PORT;
      process.env.DATABASE_PORT = '54329';
      try {
        await expect((service as any).connectWithRetries(2, 5)).rejects.toThrow();
      } finally {
        process.env.DATABASE_PORT = origPort;
      }
    });
  });
});

describe('huespedes_con_reserva · clave publicación|usuario (HU-026)', () => {
  it('separa la clave por "|" y la reconstruye igual', () => {
    const dump = { listings: [], hostNotifications: [], availabilityPeriods: [], reservedPeriods: [], guestsWithReservations: ['demo-bogota-pausada|user-7'] };
    const rows = sourceToRows('listings', dump);
    expect(rows.huespedes_con_reserva).toEqual([{ publicacion_id: 'demo-bogota-pausada', usuario_id: 'user-7', extra: {} }]);
    expect((rowsToSource('listings', rows) as { guestsWithReservations: string[] }).guestsWithReservations).toEqual(['demo-bogota-pausada|user-7']);
  });

  it('sin huéspedes con reserva en los datos no genera filas', () => {
    const rows = sourceToRows('listings', { listings: [], hostNotifications: [], availabilityPeriods: [], reservedPeriods: [] });
    expect(rows.huespedes_con_reserva).toEqual([]);
  });
});

describe('ListingsService · restaurar desde PostgreSQL reemplaza los datos', () => {
  const bootListings = () => {
    const registry: Record<string, { dump: () => any; restore: (data: unknown) => void }> = {};
    const fakePersistence = { register: (k: string, src: any) => (registry[k] = src) } as any;
    const listings = new ListingsService(new AuditService(), undefined, fakePersistence);
    listings.onModuleInit();
    return { listings, source: registry.listings };
  };

  it('descarta lo no guardado: publicaciones, periodos, reservas y huéspedes con reserva', () => {
    const { listings, source } = bootListings();
    // Copia del último estado confirmado (dump() devuelve los arreglos vivos del servicio).
    const saved = structuredClone(source.dump());
    listings.create({ title: 'Borrador no guardado' }, { token: 't', userId: 'h', email: 'h@x.com', role: Role.ANFITRION, expiresAt: Date.now() + 60_000 });
    listings.blockReservedPeriod('demo-bogota-chapinero', { checkIn: '2026-12-10', checkOut: '2026-12-12' }, 'g@x.com', 'user-9');

    source.restore(saved);

    const after = source.dump();
    expect(after.listings.map((l: any) => l.id)).toEqual(saved.listings.map((l: any) => l.id));
    expect(after.reservedPeriods).toEqual([]);
    expect(after.guestsWithReservations).toEqual([]);
  });

  it('con datos incompletos o vacíos vuelve a las publicaciones y periodos de ejemplo', () => {
    const { source } = bootListings();
    const seeds = structuredClone(source.dump());

    source.restore({});

    const after = source.dump();
    expect(after.listings.map((l: any) => l.id)).toEqual(seeds.listings.map((l: any) => l.id));
    expect(after.availabilityPeriods.map((p: any) => p.id)).toEqual(seeds.availabilityPeriods.map((p: any) => p.id));
    expect(after.hostNotifications).toEqual([]);
    expect(after.reservedPeriods).toEqual([]);
    expect(after.guestsWithReservations).toEqual([]);
  });
});
