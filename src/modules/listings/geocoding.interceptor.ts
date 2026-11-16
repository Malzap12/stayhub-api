import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Observable, from, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ListingsService } from './listings.service';

/**
 * HU-069 · Completa la geocodificación asíncrona (Nominatim) en peticiones HTTP reales
 * antes de que PersistStateInterceptor persista el estado y se envíe la respuesta al cliente.
 */
@Injectable()
export class GeocodingInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly listingsService?: ListingsService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      mergeMap((result) => {
        const listingId = (result as { id?: string } | undefined)?.id;
        if (!listingId || !this.listingsService) {
          return of(result);
        }
        return from(this.listingsService.resolvePendingGeocoding(listingId).then((updated) => updated ?? result));
      }),
    );
  }
}
