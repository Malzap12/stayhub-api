import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import {
  CheckAvailabilityQueryDto,
  AvailabilityResponseDto,
  CreateAvailabilityPeriodDto,
  AvailabilityPeriodResponseDto,
} from './dto/availability.dto';
import { HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { randomUUID } from 'node:crypto';
import type { ActiveSession } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';

type ListingData = Omit<ListingResponseDto, 'isComplete' | 'missingFields'>;

/** HU-010 CA4: información básica que debe tener una publicación para considerarse completa. */
const REQUIRED_FOR_COMPLETENESS: Array<keyof ListingData> = [
  'description',
  'city',
  'department',
  'address',
  'propertyType',
  'maxGuests',
  'pricePerNight',
  'amenities',
  'rules',
  'images',
];

export function withCompleteness(listing: ListingData): ListingResponseDto {
  const missingFields = REQUIRED_FOR_COMPLETENESS.filter((field) => {
    const value = listing[field];
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }
    return value === undefined || value === null;
  });
  return { ...listing, isComplete: missingFields.length === 0, missingFields };
}

@Injectable()
export class ListingsService {
  private listingsStore: ListingResponseDto[] = ([
    {
      id: 'pending-listing-2',
      title: 'Cabaña Alpina en Santa Elena',
      description: 'Cabaña rodeada de bosque nativo con chimenea y deck panorámico.',
      city: 'Medellín',
      department: 'Antioquia',
      address: 'Vereda Media Luna, Santa Elena',
      propertyType: PropertyType.CABANA,
      country: 'Colombia',
      pricePerNight: 120,
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      amenities: ['WIFI', 'FIREPLACE', 'PARKING'],
      rules: ['No fumar', 'No se admiten fiestas'],
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
      department: 'Antioquia',
      address: 'Carrera 76 # 33-10, Laureles',
      propertyType: PropertyType.APARTAMENTO,
      country: 'Colombia',
      pricePerNight: 95,
      maxGuests: 2,
      bedrooms: 1,
      bathrooms: 1,
      amenities: ['WIFI', 'AC', 'WORKSPACE'],
      rules: ['No fumar', 'No se admiten fiestas'],
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
      department: 'Bolívar',
      address: 'Calle del Arsenal, Getsemaní',
      propertyType: PropertyType.CASA,
      country: 'Colombia',
      pricePerNight: 210,
      maxGuests: 6,
      bedrooms: 3,
      bathrooms: 3,
      amenities: ['WIFI', 'POOL', 'AC'],
      rules: ['No fumar', 'No se admiten fiestas'],
      images: ['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1000&q=80'],
      rating: 0,
      reviewCount: 0,
      hostId: 'host-uuid-3',
      hostName: 'Andrés Salgado',
      status: ListingStatus.PENDIENTE_REVISION,
      requestedAt: new Date('2026-10-18T19:45:00.000Z'),
      createdAt: new Date('2026-10-18T12:00:00.000Z'),
    },
  ] as ListingData[]).map(withCompleteness);

  private hostNotifications: HostNotificationDto[] = [];
  private availabilityPeriodsStore: AvailabilityPeriodResponseDto[] = [];

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

  private normalizeDateOnly(dateInput: string): string {
    const trimmed = dateInput?.trim();
    if (!trimmed) {
      throw new BadRequestException('La fecha proporcionada es inválida');
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Formato de fecha inválido: ${dateInput}`);
    }
    return trimmed.slice(0, 10);
  }

  private getTodayDateOnly(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * HU-010 CA1 y CA4: crea la publicación en BORRADOR asociada al anfitrión
   * autenticado e indica si le falta información básica.
   */
  create(createDto: CreateListingDto, host?: ActiveSession): ListingResponseDto {
    const trimmed = (value?: string) => value?.trim() || undefined;
    const cleanList = (values?: string[]) =>
      (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);

    const created = withCompleteness({
      id: `listing-${randomUUID()}`,
      title: createDto.title.trim(),
      description: trimmed(createDto.description),
      city: trimmed(createDto.city),
      department: trimmed(createDto.department),
      address: trimmed(createDto.address),
      country: trimmed(createDto.country) ?? 'Colombia',
      propertyType: createDto.propertyType,
      maxGuests: createDto.maxGuests,
      pricePerNight: createDto.pricePerNight,
      bedrooms: createDto.bedrooms,
      bathrooms: createDto.bathrooms,
      amenities: cleanList(createDto.amenities),
      rules: cleanList(createDto.rules),
      images: cleanList(createDto.images),
      rating: 0,
      reviewCount: 0,
      hostId: host?.userId ?? 'mock-host-uuid',
      status: ListingStatus.BORRADOR,
      createdAt: new Date(),
    });

    this.listingsStore.push(created);
    this.recordStatusChange(
      host?.email,
      created.id,
      AuditResult.EXITOSO,
      `Publicación creada en estado ${created.status}${created.isComplete ? '' : ' (incompleta)'}`,
    );
    return created;
  }

  /** HU-010: publicaciones del anfitrión autenticado, las más recientes primero. */
  findMine(hostId: string): ListingResponseDto[] {
    return this.listingsStore
      .filter((item) => item.hostId === hostId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * HU-019 · Registrar periodos disponibles (CA1, CA2, CA3)
   */
  async registerAvailabilityPeriod(
    listingId: string,
    dto: CreateAvailabilityPeriodDto,
  ): Promise<AvailabilityPeriodResponseDto> {
    const startDate = this.normalizeDateOnly(dto?.startDate);
    const endDate = this.normalizeDateOnly(dto?.endDate);
    const today = this.getTodayDateOnly();

    // CA2: Dado que el periodo termina antes de empezar o comienza en el pasado, el sistema lo rechaza.
    if (endDate <= startDate) {
      throw new BadRequestException(
        'La fecha de fin debe ser posterior a la fecha de inicio del periodo.',
      );
    }

    if (startDate < today) {
      throw new BadRequestException(
        'La fecha de inicio del periodo no puede estar en el pasado.',
      );
    }

    // CA3: Dado que el periodo se superpone con otro ya registrado, el sistema lo rechaza e indica el periodo existente.
    const existingPeriods = this.availabilityPeriodsStore.filter(
      (period) => period.listingId === listingId,
    );

    const overlapping = existingPeriods.find(
      (existing) => startDate <= existing.endDate && endDate >= existing.startDate,
    );

    if (overlapping) {
      throw new BadRequestException(
        `El periodo solicitado se superpone con el periodo existente del ${overlapping.startDate} al ${overlapping.endDate}.`,
      );
    }

    // CA1: El periodo queda disponible para reservas.
    const createdPeriod: AvailabilityPeriodResponseDto = {
      id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      listingId,
      startDate,
      endDate,
      availableForBooking: true,
      createdAt: new Date(),
    };

    this.availabilityPeriodsStore.push(createdPeriod);
    return createdPeriod;
  }

  async getAvailabilityPeriods(listingId: string): Promise<AvailabilityPeriodResponseDto[]> {
    return this.availabilityPeriodsStore
      .filter((period) => period.listingId === listingId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
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
      if (searchDto.city && item.city?.toLowerCase() !== searchDto.city.toLowerCase()) {
        return false;
      }
      if (searchDto.guests && (item.maxGuests ?? 0) < searchDto.guests) {
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

    return withCompleteness({
      id,
      title: 'Alojamiento de prueba',
      description: 'Vista al mar y piscina',
      city: 'Medellín',
      department: 'Antioquia',
      address: 'Calle 10 # 43-20',
      country: 'Colombia',
      propertyType: PropertyType.APARTAMENTO,
      pricePerNight: 90,
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 2,
      amenities: ['WIFI', 'POOL'],
      rules: ['No fumar'],
      images: ['https://storage.stayhub.com/sample.jpg'],
      rating: 4.9,
      reviewCount: 15,
      hostId: 'mock-host-uuid',
      status: ListingStatus.ACTIVA,
      createdAt: new Date(),
    });
  }

  async getAvailability(id: string, query: CheckAvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    const periods = await this.getAvailabilityPeriods(id);
    const hasRegisteredPeriods = periods.length > 0;
    const isAvailable = hasRegisteredPeriods
      ? periods.some((p) => query.startDate >= p.startDate && query.endDate <= p.endDate)
      : true;

    return {
      listingId: id,
      isAvailable,
      blockedDates: [],
      pricePerNight: 90,
      availablePeriods: periods,
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
