import { of, firstValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  StructuredLoggingInterceptor,
  SERVICE_NAME,
} from './structured-logging.interceptor';
import { LOG_OPERATION_KEY } from '../decorators/log-operation.decorator';

describe('StructuredLoggingInterceptor (HU-062 · CA1 · RF-079, RN-021, RNF-019)', () => {
  let interceptor: StructuredLoggingInterceptor;
  let reflector: Reflector;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new StructuredLoggingInterceptor(reflector);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const createMockContext = (
    url: string,
    method = 'GET',
    user: any = null,
    correlationId = 'corr-abc-123',
    body?: any,
  ): ExecutionContext => {
    const req: any = {
      originalUrl: url,
      url,
      method,
      user,
      correlationId,
      body,
    };
    const res: any = {
      statusCode: 200,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  const createMockHandler = (result: any = { success: true }): CallHandler => ({
    handle: () => of(result),
  });

  it('CA1: debe escribir un log JSON con fecha y hora, nivel, servicio, correlationId y usuario', async () => {
    const context = createMockContext('/api/listings/1', 'GET', { userId: 'usr-999' }, 'corr-test-111');
    const handler = createMockHandler();

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedString = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(loggedString);

    expect(parsed).toMatchObject({
      level: 'INFO',
      service: SERVICE_NAME,
      correlationId: 'corr-test-111',
      user: 'usr-999',
      operation: 'publicacion',
      method: 'GET',
      path: '/api/listings/1',
      statusCode: 200,
    });
    expect(parsed.timestamp).toBeDefined();
    expect(new Date(parsed.timestamp).toString()).not.toBe('Invalid Date');
    expect(typeof parsed.durationMs).toBe('number');
  });

  it('CA1: debe clasificar adecuadamente las operaciones requeridas por el criterio de aceptación', () => {
    // 1. Autenticación
    expect(interceptor.resolveOperation(undefined, { url: '/api/auth/login', method: 'POST' } as any)).toBe('autenticacion');
    expect(interceptor.resolveOperation(undefined, { url: '/api/auth/password-recovery', method: 'POST' } as any)).toBe('autenticacion');

    // 2. Publicación
    expect(interceptor.resolveOperation(undefined, { url: '/api/listings', method: 'POST' } as any)).toBe('publicacion');
    expect(interceptor.resolveOperation(undefined, { url: '/api/listings/mine', method: 'GET' } as any)).toBe('publicacion');

    // 3. Reserva
    expect(interceptor.resolveOperation(undefined, { url: '/api/bookings/instant', method: 'POST' } as any)).toBe('reserva');

    // 4. Cancelación
    expect(interceptor.resolveOperation(undefined, { url: '/api/bookings/123/cancel', method: 'PATCH' } as any)).toBe('cancelacion');
    expect(interceptor.resolveOperation(undefined, { url: '/api/bookings/123', method: 'DELETE' } as any)).toBe('cancelacion');

    // 5. Reseña
    expect(interceptor.resolveOperation(undefined, { url: '/api/reviews', method: 'POST' } as any)).toBe('reseña');

    // 6. Administración
    expect(interceptor.resolveOperation(undefined, { url: '/api/audit/events', method: 'GET' } as any)).toBe('administracion');
    expect(interceptor.resolveOperation(undefined, { url: '/api/reports/occupancy', method: 'GET' } as any)).toBe('administracion');
    expect(interceptor.resolveOperation(undefined, { url: '/api/users', method: 'GET' } as any)).toBe('administracion');
    expect(interceptor.resolveOperation(undefined, { url: '/api/listings/admin/review-pending', method: 'GET' } as any)).toBe('administracion');
  });

  it('CA1: respeta la operación definida mediante el decorador @LogOperation', () => {
    jest.spyOn(reflector, 'get').mockImplementation((key) => {
      if (key === LOG_OPERATION_KEY) return 'administracion';
      return undefined;
    });

    const context = createMockContext('/ruta-personalizada', 'POST');
    const resolved = interceptor.resolveOperation(context, { url: '/ruta-personalizada', method: 'POST' } as any);
    expect(resolved).toBe('administracion');
  });

  it('CA1: asigna usuario anónimo si no hay sesión activa ni email en la petición', async () => {
    const context = createMockContext('/api/listings/search', 'GET', null, 'corr-anon');
    const handler = createMockHandler();

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.user).toBe('anonimo');
  });

  it('CA1: extrae el correo del cuerpo si es una operación de login o registro sin sesión aún', async () => {
    const context = createMockContext(
      '/api/auth/login',
      'POST',
      null,
      'corr-auth',
      { email: 'huesped@stayhub.test' },
    );
    const handler = createMockHandler();

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.user).toBe('huesped@stayhub.test');
    expect(parsed.operation).toBe('autenticacion');
  });
});
