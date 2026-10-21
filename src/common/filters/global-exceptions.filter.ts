import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  RequestWithCorrelation,
} from '../middleware/correlation-id.middleware';

export const GENERIC_ERROR_MESSAGE =
  'Ha ocurrido un error inesperado en el servidor. Por favor, intente más tarde.';

export const SERVICE_NAME = 'stayhub-api';

export interface StructuredErrorLog {
  timestamp: string;
  level: 'ERROR';
  service: string;
  correlationId: string;
  user: string;
  message: string;
  trace: string;
  path: string;
  method: string;
  statusCode: number;
}

/**
 * Filtro global de excepciones para captura de errores no controlados (HU-062 · CA2).
 * Registra un log JSON con nivel ERROR y su traza completa, ocultando cualquier
 * detalle técnico de la respuesta entregada al cliente final.
 */
@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelation & { user?: any; body?: any }>();

    const correlationId =
      request?.correlationId ||
      (request?.headers?.[CORRELATION_ID_HEADER] as string) ||
      'sin-correlacion';

    const user =
      request?.user?.userId ||
      request?.user?.email ||
      request?.body?.email ||
      'anonimo';

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const isUnhandled = !isHttpException || status >= HttpStatus.INTERNAL_SERVER_ERROR;

    if (isUnhandled) {
      const errorObj = exception instanceof Error ? exception : new Error(String(exception));
      const trace = errorObj.stack || String(exception);

      const errorLog: StructuredErrorLog = {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        service: SERVICE_NAME,
        correlationId,
        user,
        message: errorObj.message || 'Error no controlado',
        trace,
        path: request?.originalUrl || request?.url || '',
        method: request?.method || '',
        statusCode: status,
      };

      console.error(JSON.stringify(errorLog));

      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: GENERIC_ERROR_MESSAGE,
        correlationId,
        timestamp: errorLog.timestamp,
      });
      return;
    }

    // Errores controlados (4xx): preservar respuesta de HttpException
    const exceptionResponse = (exception as HttpException).getResponse();
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      response.status(status).json({
        ...exceptionResponse,
        correlationId,
      });
    } else {
      response.status(status).json({
        statusCode: status,
        message: exceptionResponse,
        correlationId,
      });
    }
  }
}
