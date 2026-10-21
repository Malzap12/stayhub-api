import { HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import {
  GlobalExceptionsFilter,
  GENERIC_ERROR_MESSAGE,
  SERVICE_NAME,
} from './global-exceptions.filter';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware';

describe('GlobalExceptionsFilter (HU-062 · CA2 · RF-079, RN-021, RNF-019)', () => {
  let filter: GlobalExceptionsFilter;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionsFilter();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const createMockHost = (
    reqOverrides: any = {},
  ): { host: any; mockResponse: any; mockRequest: any } => {
    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    const mockRequest: any = {
      url: '/api/test-endpoint',
      originalUrl: '/api/test-endpoint',
      method: 'POST',
      correlationId: 'corr-err-123',
      headers: { [CORRELATION_ID_HEADER]: 'corr-err-123' },
      user: { userId: 'usr-admin-1' },
      ...reqOverrides,
    };

    const host: any = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    return { host, mockResponse, mockRequest };
  };

  it('CA2: ante un error no controlado (Error nativo o inesperado), registra log JSON con nivel ERROR y su traza', () => {
    const { host, mockResponse } = createMockHost();
    const runtimeError = new TypeError('Cannot read properties of undefined (reading query)');

    filter.catch(runtimeError, host);

    // 1. Debe haber emitido el log de nivel ERROR a la consola/stdout
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedString = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(loggedString);

    expect(parsed).toMatchObject({
      level: 'ERROR',
      service: SERVICE_NAME,
      correlationId: 'corr-err-123',
      user: 'usr-admin-1',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Cannot read properties of undefined (reading query)',
    });
    expect(parsed.trace).toBeDefined();
    expect(parsed.trace).toContain('TypeError');
    expect(parsed.timestamp).toBeDefined();

    // 2. El usuario ve un mensaje genérico sin detalles técnicos (CA2)
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: GENERIC_ERROR_MESSAGE,
        correlationId: 'corr-err-123',
      }),
    );

    // 3. Confirmar que la traza técnica o el mensaje interno NO se enviaron al cliente
    const responsePayload = mockResponse.json.mock.calls[0][0];
    expect(responsePayload.trace).toBeUndefined();
    expect(responsePayload.stack).toBeUndefined();
    expect(responsePayload.message).not.toContain('Cannot read properties');
  });

  it('CA2: ante un error no controlado con HttpException de código 500, oculta detalles y registra traza', () => {
    const { host, mockResponse } = createMockHost();
    const serverError = new HttpException('Falla en la base de datos interna', HttpStatus.INTERNAL_SERVER_ERROR);

    filter.catch(serverError, host);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(parsed.level).toBe('ERROR');
    expect(parsed.trace).toBeDefined();

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: GENERIC_ERROR_MESSAGE,
      }),
    );
  });

  it('para errores controlados (4xx como BadRequestException), preserva el mensaje original y no emite traza ERROR', () => {
    const { host, mockResponse } = createMockHost();
    const badRequest = new BadRequestException('El campo fecha es obligatorio');

    filter.catch(badRequest, host);

    // No debe registrarse como error no controlado
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'El campo fecha es obligatorio',
        correlationId: 'corr-err-123',
      }),
    );
  });
});
