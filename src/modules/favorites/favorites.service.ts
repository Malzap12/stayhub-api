import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { ListingsService } from '../listings/listings.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import {
  FavoriteIdsDto,
  FavoriteListingItemDto,
  FavoritesPageDto,
  FavoriteToggleResultDto,
} from './dto/favorite.dto';

export interface StoredFavorite {
  id: string;
  guestId: string;
  guestEmail: string;
  listingId: string;
  savedAt: Date;
}

const DEFAULT_FAVORITES_LIMIT = 10;
const MAX_FAVORITES_LIMIT = 50;

/**
 * HU-072 · Guardar alojamientos en mis favoritos (EP-18).
 * Exclusivo para huéspedes autenticados: idempotente al guardar, paginado del más reciente
 * al más antiguo y refleja el estado vigente de cada publicación (RN-006, RNF-002, RNF-022).
 */
@Injectable()
export class FavoritesService implements OnModuleInit {
  private favorites: StoredFavorite[] = [];

  constructor(
    @Optional() private readonly listingsService?: ListingsService,
    @Optional() private readonly persistence?: StatePersistenceService,
  ) {}

  onModuleInit(): void {
    this.persistence?.register('favorites', {
      dump: () => ({ favorites: this.favorites }),
      restore: (data) => {
        const state = data as { favorites?: StoredFavorite[] } | null;
        this.favorites = (state?.favorites ?? []).map((item) => ({
          ...item,
          savedAt: item.savedAt ? new Date(item.savedAt) : new Date(),
        }));
      },
    });
  }

  /** CA1 & CA3: agrega el alojamiento ACTIVO a los favoritos del huésped de forma idempotente. */
  saveFavorite(listingId: string, user: ActiveSession): FavoriteToggleResultDto {
    this.assertGuest(user);
    const cleanId = listingId?.trim();
    if (!cleanId) {
      throw new BadRequestException('Debes indicar el alojamiento.');
    }

    const existing = this.favorites.find(
      (fav) => fav.listingId === cleanId && this.isMyFavorite(fav, user),
    );
    if (existing) {
      return {
        listingId: existing.listingId,
        saved: true,
        savedAt: existing.savedAt,
      };
    }

    const listing = this.listingsService?.getListing(cleanId);
    if (!listing) {
      throw new NotFoundException('Alojamiento no encontrado.');
    }

    if (listing.status !== ListingStatus.ACTIVA) {
      throw new BadRequestException('Solo puedes guardar alojamientos activos.');
    }

    const entry: StoredFavorite = {
      id: `fav-${randomUUID()}`,
      guestId: user.userId,
      guestEmail: user.email.trim().toLowerCase(),
      listingId: listing.id,
      savedAt: new Date(),
    };
    this.favorites.push(entry);

    return {
      listingId: entry.listingId,
      saved: true,
      savedAt: entry.savedAt,
    };
  }

  /** CA2 & CA5: quita un alojamiento de favoritos sin importar su estado vigente. */
  removeFavorite(listingId: string, user: ActiveSession): FavoriteToggleResultDto {
    this.assertGuest(user);
    const cleanId = listingId?.trim();
    if (!cleanId) {
      throw new BadRequestException('Debes indicar el alojamiento.');
    }

    this.favorites = this.favorites.filter(
      (fav) => !(fav.listingId === cleanId && this.isMyFavorite(fav, user)),
    );

    return {
      listingId: cleanId,
      saved: false,
    };
  }

  /** CA1: devuelve los IDs guardados del huésped ordenados del más reciente al más antiguo. */
  getMyFavoriteIds(user: ActiveSession): FavoriteIdsDto {
    this.assertGuest(user);
    const mine = this.favorites
      .filter((fav) => this.isMyFavorite(fav, user))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

    return {
      listingIds: mine.map((fav) => fav.listingId),
    };
  }

  /** CA4 & CA5: lista paginada de favoritos del más reciente al más antiguo con estado vigente. */
  listMyFavorites(
    user: ActiveSession,
    options: { page?: number; limit?: number } = {},
  ): FavoritesPageDto {
    this.assertGuest(user);
    const mine = this.favorites
      .filter((fav) => this.isMyFavorite(fav, user))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

    const { page, limit } = this.normalizePagination(options.page, options.limit);
    const total = mine.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    const data = mine.slice(start, start + limit).map((fav) => this.toItem(fav));

    return {
      data,
      page: safePage,
      limit,
      total,
      totalPages,
    };
  }

  private assertGuest(user: ActiveSession): void {
    if (!user || user.role !== Role.HUESPED) {
      throw new ForbiddenException('Solo los huéspedes pueden gestionar su lista de favoritos.');
    }
  }

  private isMyFavorite(fav: StoredFavorite, user: ActiveSession): boolean {
    const email = user.email?.trim().toLowerCase();
    return fav.guestId === user.userId || (Boolean(email) && fav.guestEmail.toLowerCase() === email);
  }

  private toItem(fav: StoredFavorite): FavoriteListingItemDto {
    const listing = this.listingsService?.getListing(fav.listingId);
    const status = listing?.status ?? 'NO_DISPONIBLE';
    const available = status === ListingStatus.ACTIVA;
    const firstImg = listing?.images?.[0] as unknown;
    const imageUrl =
      typeof firstImg === 'string'
        ? firstImg
        : (firstImg as { url?: string } | undefined)?.url;

    return {
      id: fav.id,
      listingId: fav.listingId,
      title: listing?.title ?? 'Alojamiento',
      city: listing?.city ?? '',
      pricePerNight: listing?.pricePerNight ?? 0,
      currency: 'COP',
      rating: listing?.rating ?? 0,
      ...(imageUrl ? { imageUrl } : {}),
      status,
      available,
      savedAt: fav.savedAt,
    };
  }

  private normalizePagination(rawPage?: number, rawLimit?: number): { page: number; limit: number } {
    const parsedPage = Number(rawPage);
    const parsedLimit = Number(rawLimit);
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.trunc(parsedPage) : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit >= 1
        ? Math.min(MAX_FAVORITES_LIMIT, Math.trunc(parsedLimit))
        : DEFAULT_FAVORITES_LIMIT;
    return { page, limit };
  }
}
