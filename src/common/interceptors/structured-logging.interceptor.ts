import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import {
  LOG_OPERATION_KEY,
  SupportedOperation,
} from '../decorators/log-operation.decorator';
import {
  CORRELATION_ID_HEADER,
  RequestWithCorrelation,
} from '../middleware/correlation-id.middleware';

export interface StructuredLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  service: string;
  correlationId: string;
  user: string;
  operation: SupportedOperation;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

export const SERVICE_NAME = 'stayhub-api';

/**
 * Interceptor para emitir logs estructurados en JSON de las operaciones terminadas (HU-062 · CA1).
 * Incluye fecha y hora, nivel, servicio, correlationId y usuario para operaciones de
 * autenticación, publicación, reserva, cancelación, reseña o administración.
 */
@Injectable()
export class StructuredLoggingInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly reflector?: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithCorrelation & { user?: any; body?: any }>();
    const res = http.getResponse<Response>();

    const operation = this.resolveOperation(context, req);
    const correlationId =
      req?.correlationId ||
      (req?.headers?.[CORRELATION_ID_HEADER] as string) ||
      'sin-correlacion';

    const user =
      req?.user?.userId ||
      req?.user?.email ||
      req?.body?.email ||
      'anonimo';

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startTime;
          const statusCode = res?.statusCode || 200;
          const entry: StructuredLogEntry = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            service: SERVICE_NAME,
            correlationId,
            user,
            operation,
            method: req?.method || 'UNKNOWN',
            path: req?.originalUrl || req?.url || '',
            statusCode,
            durationMs,
          };
          console.log(JSON.stringify(entry));
        },
      }),
    );
  }

  public resolveOperation(
    context?: ExecutionContext,
    req?: Request,
  ): SupportedOperation {
    if (this.reflector && context) {
      const handlerOperation = this.reflector.get<SupportedOperation>(
        LOG_OPERATION_KEY,
        context.getHandler(),
      );
      if (handlerOperation) return handlerOperation;

      const classOperation = this.reflector.get<SupportedOperation>(
        LOG_OPERATION_KEY,
        context.getClass(),
      );
      if (classOperation) return classOperation;
    }

    const path = (req?.originalUrl || req?.url || '').toLowerCase();
    const method = (req?.method || '').toUpperCase();

    if (path.includes('/auth') || path.includes('password-recovery')) {
      return 'autenticacion';
    }
    if (path.includes('/bookings') || path.includes('/reservas')) {
      if (path.includes('/cancel') || method === 'DELETE') {
        return 'cancelacion';
      }
      return 'reserva';
    }
    if (path.includes('/listings') || path.includes('/alojamientos') || path.includes('/publicaciones')) {
      if (
        path.includes('/admin') ||
        path.includes('/revision') ||
        path.includes('/review-pending')
      ) {
        return 'administracion';
      }
      return 'publicacion';
    }
    if (path.includes('/reviews') || path.includes('/resenas')) {
      return 'reseña';
    }
    if (
      path.includes('/reports') ||
      path.includes('/audit') ||
      path.includes('/users') ||
      path.includes('/admin')
    ) {
      return 'administracion';
    }

    return 'operacion_general';
  }
}
