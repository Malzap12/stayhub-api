import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { StatePersistenceService } from './state-persistence.service';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Interceptor global de persistencia:
 * - En métodos que modifican datos (POST, PUT, PATCH, DELETE) espera a que flush() termine antes de responder.
 * - Si flush() falla, responde 503 ServiceUnavailableException.
 * - Si el handler ya falló, intenta flush() (para bitácora de auditoría) sin ocultar el error original.
 * - En métodos de solo lectura (GET, HEAD, OPTIONS) no ejecuta guardado.
 */
@Injectable()
export class PersistStateInterceptor implements NestInterceptor {
  constructor(private readonly persistence: StatePersistenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method: string | undefined = context.switchToHttp().getRequest()?.method;
    if (!method || READ_ONLY_METHODS.has(method.toUpperCase())) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap((result) =>
        from(
          this.persistence.flush().then(
            () => result,
            () => {
              throw new ServiceUnavailableException(
                'No se pudo guardar el cambio en la base de datos. Intenta de nuevo.',
              );
            },
          ),
        ),
      ),
      catchError((handlerError) =>
        from(
          this.persistence
            .flush()
            .catch(() => {})
            .then(() => {
              throw handlerError;
            }),
        ),
      ),
    );
  }
}
