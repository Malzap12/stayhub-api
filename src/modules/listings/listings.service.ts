import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CheckAvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';
import { HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

@Injectable()
export class ListingsService {
  private listingsStore: ListingResponseDto[] = [
    {
      id: 'pending-listing-2',
      title: 'Cabaña Alpina en Santa Elena',
      description: 'Cabaña rodeada de bosque nativo con chimenea y deck panorámico.',
      city: 'Medellín',
      country: 'Colombia',
      pricePerNight: 120,
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      amenities: ['WIFI', 'FIREPLACE', 'PARKING'],
      images: ['https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80'],
      rating: 0,
      reviewCount: 0,
      hostId: 'host-uuid-2',
      hostName: 'Carlos Mendoza',
      status: ListingStatus.PENDIENTE_REVISION,
      requestedAt: new Date('2026-10-16T14:30:00.000Z'),
      createdAt: new Date('2026-10-15T10:00:00.000Z'),
    },
    {
      id: 'pending-listing-1',
      title: 'Ático Minimalista en Laureles',
      description: 'Iluminación cenital, terraza privada y estudio insonorizado.',
      city: 'Medellín',
      country: 'Colombia',
      pricePerNight: 95,
      maxGuests: 2,
      bedrooms: 1,
      bathrooms: 1,
      amenities: ['WIFI', 'AC', 'WORKSPACE'],
      images: ['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80'],
      rating: 0,
      reviewCount: 0,
      hostId: 'host-uuid-1',
      hostName: 'Laura Restrepo',
      status: ListingStatus.PENDIENTE_REVISION,
      requestedAt: new Date('2026-10-14T08:15:00.000Z'),
      createdAt: new Date('2026-10-13T18:00:00.000Z'),
    },
    {
      id: 'pending-listing-3',
      title: 'Casa Colonial frente al Mar',
      description: 'Arquitectura republicana restaurada con piscina interior.',
      city: 'Cartagena',
      country: 'Colombia',
      pricePerNight: 210,
      maxGuests: 6,
      bedrooms: 3,
      bathrooms: 3,
      amenities: ['WIFI', 'POOL', 'AC'],
      images: ['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1000&q=80'],
      rating: 0,
      reviewCount: 0,
      hostId: 'host-uuid-3',
      hostName: 'Andrés Salgado',
      status: ListingStatus.PENDIENTE_REVISION,
      requestedAt: new Date('2026-10-18T19:45:00.000Z'),
      createdAt: new Date('2026-10-18T12:00:00.000Z'),
    },
  ];

  private hostNotifications: HostNotificationDto[] = [];

  constructor(private readonly auditService: AuditService) {}

  private recordStatusChange(
    actor: string | undefined,
    listingId: string,
    result: AuditResult,
    detail: string,
  ): void {
    this.auditService.record({
      actor,
      action: AuditAction.LISTING_STATUS_CHANGE,
      entity: 'Listing',
      entityId: listingId,
      result,
      detail,
    });
  }

  async create(createDto: CreateListingDto, actor?: string): Promise<ListingResponseDto> {
    const now = new Date();
    const created: ListingResponseDto = {
      id: 'mock-listing-uuid-1',
      ...createDto,
      rating: 0,
      reviewCount: 0,
      hostId: 'mock-host-uuid',
      status: ListingStatus.PENDIENTE_REVISION,
      requestedAt: now,
      createdAt: now,
    };
    this.listingsStore.push(created);
    this.recordStatusChange(
      actor,
      created.id,
      AuditResult.EXITOSO,
      `Publicación creada en estado ${created.status}`,
    );
    return created;
  }

  /**
   * HU-050 CA1: Cola de revisión de publicaciones en PENDIENTE_REVISION
   * ordenadas por fecha de solicitud (requestedAt ascendente: más antiguas primero).
   */
  async findPendingReviewQueue(): Promise<ListingResponseDto[]> {
    return this.listingsStore
      .filter((item) => item.status === ListingStatus.PENDIENTE_REVISION)
      .sort((a, b) => {
        const timeA = a.requestedAt ? new Date(a.requestedAt).getTime() : new Date(a.createdAt).getTime();
        const timeB = b.requestedAt ? new Date(b.requestedAt).getTime() : new Date(b.createdAt).getTime();
        return timeA - timeB;
      });
  }

  /**
   * HU-050 CA2: Aprobar una publicación pendiente -> pasa a ACTIVA,
   * aparece en las búsquedas y se notifica al anfitrión.
   */
  async approveListing(id: string, actor?: string): Promise<ListingModerationResponseDto> {
    const listing = this.listingsStore.find((item) => item.id === id);
    if (!listing) {
      this.recordStatusChange(actor, id, AuditResult.FALLIDO, 'Aprobación rechazada: publicación no encontrada');
      throw new NotFoundException(`Publicación con id ${id} no encontrada`);
    }
    if (listing.status !== ListingStatus.PENDIENTE_REVISION) {
      const message = `Solo se pueden aprobar publicaciones en estado PENDIENTE_REVISION (actual: ${listing.status})`;
      this.recordStatusChange(actor, id, AuditResult.FALLIDO, message);
      throw new BadRequestException(message);
    }

    listing.status = ListingStatus.ACTIVA;
    listing.returnReason = undefined;
    this.recordStatusChange(
      actor,
      id,
      AuditResult.EXITOSO,
      `${ListingStatus.PENDIENTE_REVISION} -> ${ListingStatus.ACTIVA}`,
    );

    const notification: HostNotificationDto = {
      id: `notif-${Date.now()}`,
      hostId: listing.hostId,
      listingId: listing.id,
      type: 'APROBADA',
      message: `Tu publicación "${listing.title}" ha sido aprobada y ahora está ACTIVA en las búsquedas.`,
      createdAt: new Date(),
    };
    this.hostNotifications.push(notification);

    return {
      listingId: listing.id,
      status: listing.status,
      notification,
    };
  }

  /**
   * HU-050 CA3: Devolver una publicación pendiente con un motivo ->
   * pasa a BORRADOR y el anfitrión ve el motivo.
   */
  async returnListing(
    id: string,
    dto: ReturnListingDto,
    actor?: string,
  ): Promise<ListingModerationResponseDto> {
    const reason = dto?.reason?.trim();
    if (!reason) {
      this.recordStatusChange(actor, id, AuditResult.FALLIDO, 'Devolución rechazada: motivo obligatorio');
      throw new BadRequestException('El motivo de devolución es obligatorio');
    }

    const listing = this.listingsStore.find((item) => item.id === id);
    if (!listing) {
      this.recordStatusChange(actor, id, AuditResult.FALLIDO, 'Devolución rechazada: publicación no encontrada');
      throw new NotFoundException(`Publicación con id ${id} no encontrada`);
    }
    if (listing.status !== ListingStatus.PENDIENTE_REVISION) {
      const message = `Solo se pueden devolver publicaciones en estado PENDIENTE_REVISION (actual: ${listing.status})`;
      this.recordStatusChange(actor, id, AuditResult.FALLIDO, message);
      throw new BadRequestException(message);
    }

    listing.status = ListingStatus.BORRADOR;
    listing.returnReason = reason;
    this.recordStatusChange(
      actor,
      id,
      AuditResult.EXITOSO,
      `${ListingStatus.PENDIENTE_REVISION} -> ${ListingStatus.BORRADOR}. Motivo: ${reason}`,
    );

    const notification: HostNotificationDto = {
      id: `notif-${Date.now()}`,
      hostId: listing.hostId,
      listingId: listing.id,
      type: 'DEVUELTA',
      message: `Tu publicación "${listing.title}" fue devuelta a BORRADOR. Motivo: ${reason}`,
      reason,
      createdAt: new Date(),
    };
    this.hostNotifications.push(notification);

    return {
      listingId: listing.id,
      status: listing.status,
      returnReason: listing.returnReason,
      notification,
    };
  }

  async getHostNotifications(hostId?: string): Promise<HostNotificationDto[]> {
    if (!hostId) {
      return this.hostNotifications;
    }
    return this.hostNotifications.filter((n) => n.hostId === hostId);
  }

  async search(searchDto: SearchListingsDto): Promise<PaginatedListingsResponseDto> {
    const activeListings = this.listingsStore.filter((item) => item.status === ListingStatus.ACTIVA);
    const filtered = activeListings.filter((item) => {
      if (searchDto.city && item.city.toLowerCase() !== searchDto.city.toLowerCase()) {
        return false;
      }
      if (searchDto.guests && item.maxGuests < searchDto.guests) {
        return false;
      }
      return true;
    });

    const page = searchDto.page || 1;
    const limit = searchDto.limit || 10;
    const total = filtered.length;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      data: filtered.slice((page - 1) * limit, page * limit),
      total,
      page,
      totalPages,
    };
  }

  async findOne(id: string): Promise<ListingResponseDto> {
    const existing = this.listingsStore.find((item) => item.id === id);
    if (existing) {
      return existing;
    }

    return {
      id,
      title: 'Alojamiento de prueba',
      description: 'Vista al mar y piscina',
      city: 'Medellín',
      country: 'Colombia',
      pricePerNight: 90,
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      amenities: ['WIFI', 'POOL'],
      images: ['https://storage.stayhub.com/sample.jpg'],
      rating: 4.9,
      reviewCount: 15,
      hostId: 'mock-host-uuid',
      status: ListingStatus.ACTIVA,
      createdAt: new Date(),
    };
  }

  async getAvailability(id: string, query: CheckAvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    return {
      listingId: id,
      isAvailable: true,
      blockedDates: [],
      pricePerNight: 90,
    };
  }

  async getReviews(listingId: string) {
    return {
      listingId,
      averageRating: 4.9,
      totalReviews: 2,
      reviews: [
        {
          id: 'review-1',
          authorName: 'Camila Gómez',
          rating: 5,
          comment: 'Excelente ubicación, impecable y atención inmediata del anfitrión.',
          createdAt: '2026-10-01T14:30:00.000Z',
        },
        {
          id: 'review-2',
          authorName: 'Andrés Mejía',
          rating: 4.8,
          comment: 'Muy cómodo, tranquilo y fiel a las fotografías publicadas.',
          createdAt: '2026-10-10T09:15:00.000Z',
        },
      ],
    };
  }
}
