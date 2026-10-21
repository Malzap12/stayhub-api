import { CorrelationIdMiddleware, CORRELATION_ID_HEADER } from './correlation-id.middleware';

describe('CorrelationIdMiddleware (HU-062 · RF-079, RNF-019)', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  it('debe conservar el correlationId recibido en el encabezado x-correlation-id', () => {
    const customCorrelationId = 'custom-correlation-1234';
    const req: any = { headers: { [CORRELATION_ID_HEADER]: customCorrelationId } };
    const res: any = {
      setHeader: jest.fn(),
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toBe(customCorrelationId);
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, customCorrelationId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('debe generar un nuevo UUID si no se envía el encabezado x-correlation-id', () => {
    const req: any = { headers: {} };
    const res: any = {
      setHeader: jest.fn(),
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toBeDefined();
    expect(typeof req.correlationId).toBe('string');
    expect(req.correlationId.length).toBeGreaterThan(10);
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, req.correlationId);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
