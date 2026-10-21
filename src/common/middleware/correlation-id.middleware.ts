import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export interface RequestWithCorrelation extends Request {
  correlationId?: string;
}

/**
 * Middleware para generar o propagar el identificador de correlación (HU-062 · RF-079, RNF-019).
 * Inyecta el encabezado 'x-correlation-id' en la respuesta para trazabilidad de punta a punta.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelation, res: Response, next: NextFunction): void {
    const incomingHeader = req.headers?.[CORRELATION_ID_HEADER];
    const correlationId =
      typeof incomingHeader === 'string' && incomingHeader.trim().length > 0
        ? incomingHeader.trim()
        : randomUUID();

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
