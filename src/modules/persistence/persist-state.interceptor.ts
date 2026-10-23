import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { StatePersistenceService } from './state-persistence.service';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Programa el guardado del estado después de cada petición que puede modificar datos. */
@Injectable()
export class PersistStateInterceptor implements NestInterceptor {
  constructor(private readonly persistence: StatePersistenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method: string | undefined = context.switchToHttp().getRequest()?.method;
    if (!method || READ_ONLY_METHODS.has(method.toUpperCase())) {
      return next.handle();
    }
    // También tras errores: un intento fallido puede dejar eventos de auditoría.
    return next.handle().pipe(finalize(() => this.persistence.scheduleSave()));
  }
}
