import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { AdditionalServiceDto, ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import {
  CheckAvailabilityQueryDto,
  AvailabilityResponseDto,
  CreateAvailabilityPeriodDto,
  AvailabilityPeriodResponseDto,
  BlockReservedPeriodDto,
  BlockedPeriodResponseDto,
} from './dto/availability.dto';
import { HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
import { MyListingDto } from './dto/my-listing.dto';
import {
  ListingPricingResponseDto,
  LongStayDiscountDto,
  MAX_LONG_STAY_DISCOUNT_PERCENT,
  MIN_LONG_STAY_DISCOUNT_PERCENT,
  MIN_LONG_STAY_NIGHTS,
  UpdateListingPricingDto,
} from './dto/listing-pricing.dto';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { randomUUID } from 'node:crypto';
import { AuthService, type ActiveSession } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { DEMO_AVAILABILITY_PERIODS, DEMO_LISTINGS } from './listings.seed';
import { ListingDetailDto } from './dto/listing-detail.dto';
import { CalendarDayStatus, CalendarMonthDto, ListingCalendarDto } from './dto/calendar.dto';
import { CANCELLATION_POLICIES, DEFAULT_CANCELLATION_POLICY } from './cancellation-policies';
import { Role } from '../../common/enums/role.enum';

/** HU-026 CA2: mismo mensaje si no existe o no se puede ver, para no revelar publicaciones no activas. */
export const LISTING_NOT_AVAILABLE = 'Esta publicación no está disponible';

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  [PropertyType.CASA]: 'Casa',
  [PropertyType.APARTAMENTO]: 'Apartamento',
  [PropertyType.CABANA]: 'Cabaña',
  [PropertyType.FINCA]: 'Finca',
  [PropertyType.HABITACION]: 'Habitación',
  [PropertyType.OTRO]: 'Otro',
};

/** HU-026 CA1: detalle público con ubicación textual, política de cancelación y servicios adicionales. */
export function toListingDetail(listing: ListingResponseDto): ListingDetailDto {
  const location = {
    address: listing.address,
    city: listing.city,
    department: listing.department,
    country: listing.country,
  };
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    location: {
      ...location,
      text: [location.address, location.city, location.department, location.country].filter(Boolean).join(', '),
    },
    propertyType: listing.propertyType,
    propertyTypeLabel: listing.propertyType ? PROPERTY_TYPE_LABELS[listing.propertyType] : undefined,
    maxGuests: listing.maxGuests,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    pricePerNight: listing.pricePerNight,
    amenities: listing.amenities,
    rules: listing.rules,
    images: listing.images,
    cancellationPolicy: CANCELLATION_POLICIES[listing.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY],
    additionalServices: listing.additionalServices ?? [],
    averageRating: listing.rating,
    reviewCount: listing.reviewCount,
    hostName: listing.hostName,
    status: listing.status ?? ListingStatus.BORRADOR,
  };
}

type ListingData = Omit<ListingResponseDto, 'isComplete' | 'missingFields'>;

/** HU-019 CA2: las fechas de los periodos se comparan con el día actual en Colombia. */
const BUSINESS_TIME_ZONE = 'America/Bogota';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** HU-024: compara ciudades sin distinguir mayúsculas, tildes ni espacios sobrantes (Bogota = Bogotá). */
export function normalizeCity(city: string): string {
  return city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * HU-010 CA4 y HU-013 CA1: información mínima de una publicación (9 campos)
 * más al menos una imagen. Sin ella no se puede solicitar la activación.
 */
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

/** HU-013 CA2: nombre de cada campo mínimo tal como lo ve el anfitrión. */
export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  description: 'descripción',
  city: 'ciudad',
  department: 'departamento',
  address: 'dirección o referencia',
  propertyType: 'tipo de inmueble',
  maxGuests: 'capacidad',
  pricePerNight: 'precio por noche',
  amenities: 'servicios',
  rules: 'reglas',
  images: 'al menos una imagen',
};

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

/** HU-012: nombre del estado tal como lo ve el anfitrión. */
export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  [ListingStatus.BORRADOR]: 'Borrador',
  [ListingStatus.PENDIENTE_REVISION]: 'En revisión',
  [ListingStatus.ACTIVA]: 'Activa',
  [ListingStatus.PAUSADA]: 'Pausada',
  [ListingStatus.BLOQUEADA]: 'Bloqueada',
};

/**
 * HU-012 CA1 y CA2: resumen de la publicación para «Mis publicaciones», con el motivo
 * del administrador cuando fue bloqueada o devuelta a borrador (RN-005).
 */
export function toMyListing(listing: ListingResponseDto): MyListingDto {
  const status = listing.status ?? ListingStatus.BORRADOR;
  const blockReason = listing.blockReason?.trim();
  const returnReason = listing.returnReason?.trim();

  let adminReason: Pick<MyListingDto, 'adminReasonType' | 'adminReason'> = {};
  if (status === ListingStatus.BLOQUEADA && blockReason) {
    adminReason = { adminReasonType: 'BLOQUEADA', adminReason: blockReason };
  } else if (status === ListingStatus.BORRADOR && returnReason) {
    adminReason = { adminReasonType: 'DEVUELTA', adminReason: returnReason };
  }

  return {
    id: listing.id,
    title: listing.title,
    city: listing.city,
    pricePerNight: listing.pricePerNight,
    status,
    statusLabel: LISTING_STATUS_LABELS[status],
    ...adminReason,
    isComplete: listing.isComplete,
    missingFields: listing.missingFields,
    createdAt: listing.createdAt,
  };
}

/**
 * HU-023 · Calcula las noches dentro del intervalo semiabierto [checkIn, checkOut) (AMB-09).
 * Por ejemplo, del 2027-03-10 al 2027-03-12 retorna ['2027-03-10', '2027-03-11'].
 */
export function nightsInInterval(checkIn: string, checkOut: string): string[] {
  const startMs = Date.parse(`${checkIn}T00:00:00.000Z`);
  const endMs = Date.parse(`${checkOut}T00:00:00.000Z`);
  const nights: string[] = [];
  for (let current = startMs; current < endMs; current += MS_PER_DAY) {
    nights.push(new Date(current).toISOString().slice(0, 10));
  }
  return nights;
}

interface PersistedListingsState {
  listings: ListingResponseDto[];
  hostNotifications: HostNotificationDto[];
  availabilityPeriods: AvailabilityPeriodResponseDto[];
  reservedPeriods: BlockedPeriodResponseDto[];
  guestsWithReservations: string[];
}

/** Redondea montos y porcentajes a 2 decimales, como NUMERIC(12,2) en la base de datos. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * HU-015 CA3: valida la tarifa de limpieza (>= 0 COP) y el descuento (0 % a 50 % desde al menos 1 noche).
 * Se valida también en el servicio para no depender solo del ValidationPipe. Retorna los errores por campo.
 */
export function validateListingPricing(dto?: Partial<UpdateListingPricingDto>): Record<string, string> {
  const errors: Record<string, string> = {};
  const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

  if (!isNumber(dto?.cleaningFee) || dto.cleaningFee < 0) {
    errors.cleaningFee = 'La tarifa de limpieza debe ser mayor o igual a 0 COP.';
  }

  const percent = dto?.longStayDiscountPercent;
  const hasPercent = percent !== undefined && percent !== null;
  if (
    hasPercent &&
    (!isNumber(percent) || percent < MIN_LONG_STAY_DISCOUNT_PERCENT || percent > MAX_LONG_STAY_DISCOUNT_PERCENT)
  ) {
    errors.longStayDiscountPercent = 'El descuento por estancia larga debe estar entre 0 % y 50 %.';
  }

  const minNights = dto?.longStayMinNights;
  const needsNights = isNumber(percent) && percent > 0;
  const hasNights = minNights !== undefined && minNights !== null;
  if ((needsNights || hasNights) && (!Number.isInteger(minNights) || (minNights as number) < MIN_LONG_STAY_NIGHTS)) {
    errors.longStayMinNights = 'Las noches mínimas para el descuento deben ser un número entero mayor o igual a 1.';
  }

  return errors;
}

@Injectable()
export class ListingsService implements OnModuleInit {
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
    ...DEMO_LISTINGS,
  ] as ListingData[]).map(withCompleteness);

  private hostNotifications: HostNotificationDto[] = [];
  private availabilityPeriodsStore: AvailabilityPeriodResponseDto[] = [...DEMO_AVAILABILITY_PERIODS];
  private reservedPeriodsStore: BlockedPeriodResponseDto[] = [];
  /** HU-026 CA2: huéspedes con reservas en cada publicación (`listingId|userId`), que pueden ver su detalle aunque no esté ACTIVA. */
  private readonly guestsWithReservations = new Set<string>();
  private readonly seedListings: ListingResponseDto[];
  private readonly seedAvailabilityPeriods: AvailabilityPeriodResponseDto[];

  constructor(
    private readonly auditService: AuditService,
    @Optional() private readonly authService?: AuthService,
    @Optional() private readonly persistence?: StatePersistenceService,
  ) {
    this.seedListings = structuredClone(this.listingsStore);
    this.seedAvailabilityPeriods = structuredClone(this.availabilityPeriodsStore);
  }

  onModuleInit(): void {
    this.persistence?.register('listings', {
      dump: () => ({
        listings: this.listingsStore,
        hostNotifications: this.hostNotifications,
        availabilityPeriods: this.availabilityPeriodsStore,
        reservedPeriods: this.reservedPeriodsStore,
        guestsWithReservations: [...this.guestsWithReservations],
      }),
      restore: (data) => this.restoreState(data as PersistedListingsState),
    });
  }

  /** Recupera lo guardado y agrega las publicaciones y periodos de ejemplo que se sumen después al código. */
  private restoreState(state: PersistedListingsState): void {
    const withSeeds = <T extends { id: string }>(saved: T[], seeds: T[]) => [
      ...saved,
      ...seeds.filter((seed) => !saved.some((item) => item.id === seed.id)),
    ];
    this.listingsStore = withSeeds(state.listings, this.listingsStore);
    this.availabilityPeriodsStore = withSeeds(state.availabilityPeriods, this.availabilityPeriodsStore);
    this.hostNotifications = state.hostNotifications;
    this.reservedPeriodsStore = state.reservedPeriods;
    state.guestsWithReservations.forEach((key) => this.guestsWithReservations.add(key));
  }

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

  /** Acepta solo fechas de calendario reales en formato YYYY-MM-DD (rechaza, por ejemplo, 2027-02-30). */
  private normalizeDateOnly(dateInput: string): string {
    const trimmed = dateInput?.trim();
    if (!trimmed) {
      throw new BadRequestException('La fecha proporcionada es inválida');
    }
    const dateOnly = trimmed.slice(0, 10);
    const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
    if (!DATE_ONLY_PATTERN.test(dateOnly) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOnly) {
      throw new BadRequestException(`Formato de fecha inválido: ${dateInput}`);
    }
    return dateOnly;
  }

  /** "Hoy" en la zona horaria del negocio, para no rechazar el día actual en la noche (en UTC ya es mañana). */
  private getTodayDateOnly(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(new Date());
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
      // HU-050: el administrador ve en la cola de revisión quién publicó.
      hostName: host ? this.authService?.findById(host.userId)?.name : undefined,
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

  /**
   * HU-010 y HU-012 · Mis publicaciones (RF-016): solo las del anfitrión autenticado,
   * las más recientes primero, con título, ciudad, precio, estado y motivo del administrador.
   */
  findMine(hostId: string): MyListingDto[] {
    return this.listingsStore
      .filter((item) => item.hostId === hostId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(toMyListing);
  }

  /**
   * HU-013 · Solicitar la activación de mi publicación (CA1, CA2, CA3, RF-017).
   * Solo el anfitrión dueño puede solicitarla (RN-005) y solo desde BORRADOR (AMB-03).
   * Si tiene los 9 campos mínimos y al menos una imagen pasa a PENDIENTE_REVISION;
   * cada intento, exitoso o fallido, queda en la auditoría (RN-021).
   */
  requestActivation(id: string, host?: ActiveSession): MyListingDto {
    const listing = this.listingsStore.find((item) => item.id === id);
    const fail = (detail: string) =>
      this.recordStatusChange(host?.email, id, AuditResult.FALLIDO, `Solicitud de activación rechazada: ${detail}`);

    const ownerId = host?.userId;
    if (!ownerId || listing?.hostId !== ownerId) {
      fail('publicación no encontrada o de otro anfitrión');
      throw new NotFoundException(`Publicación con id ${id} no encontrada`);
    }

    const currentStatus = listing.status ?? ListingStatus.BORRADOR;
    if (currentStatus !== ListingStatus.BORRADOR) {
      const message = `Solo puedes solicitar la activación de una publicación en BORRADOR (estado actual: ${LISTING_STATUS_LABELS[currentStatus]})`;
      fail(message);
      throw new BadRequestException(message);
    }

    const { missingFields } = withCompleteness(listing);
    if (missingFields.length > 0) {
      const missingFieldLabels = missingFields.map((field) => REQUIRED_FIELD_LABELS[field] ?? field);
      fail(`faltan ${missingFields.join(', ')}`);
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `No puedes solicitar la activación: completa los campos faltantes. Falta: ${missingFieldLabels.join(', ')}.`,
        missingFields,
        missingFieldLabels,
      });
    }

    listing.status = ListingStatus.PENDIENTE_REVISION;
    listing.requestedAt = new Date();
    listing.returnReason = undefined;
    listing.isComplete = true;
    listing.missingFields = [];
    this.recordStatusChange(
      host?.email,
      id,
      AuditResult.EXITOSO,
      `${ListingStatus.BORRADOR} -> ${ListingStatus.PENDIENTE_REVISION} (solicitud de activación)`,
    );
    return toMyListing(listing);
  }

  /**
   * HU-019 · Registrar periodos disponibles (CA1, CA2, CA3, RF-025).
   * Solo el anfitrión dueño del alojamiento registra periodos; cada intento,
   * aceptado o rechazado, queda en la auditoría.
   */
  async registerAvailabilityPeriod(
    listingId: string,
    dto: CreateAvailabilityPeriodDto,
    host?: ActiveSession,
  ): Promise<AvailabilityPeriodResponseDto> {
    const fail = (detail: string) =>
      this.recordAvailabilityChange(host?.email, listingId, AuditResult.FALLIDO, `Periodo rechazado: ${detail}`);

    this.findOwnListing(listingId, host, fail);

    let startDate: string;
    let endDate: string;
    try {
      startDate = this.normalizeDateOnly(dto?.startDate);
      endDate = this.normalizeDateOnly(dto?.endDate);
    } catch (error) {
      fail('fechas inválidas');
      throw error;
    }

    // CA2: Dado que el periodo termina antes de empezar o comienza en el pasado, el sistema lo rechaza.
    if (endDate <= startDate) {
      const message = 'La fecha de fin debe ser posterior a la fecha de inicio del periodo.';
      fail(message);
      throw new BadRequestException(message);
    }

    if (startDate < this.getTodayDateOnly()) {
      const message = 'La fecha de inicio del periodo no puede estar en el pasado.';
      fail(message);
      throw new BadRequestException(message);
    }

    // CA3: Dado que el periodo se superpone con otro ya registrado, el sistema lo rechaza e indica el periodo existente.
    const overlapping = this.periodsOf(listingId).find(
      (existing) => startDate <= existing.endDate && endDate >= existing.startDate,
    );

    if (overlapping) {
      const message = `El periodo solicitado se superpone con el periodo existente del ${overlapping.startDate} al ${overlapping.endDate}.`;
      fail(message);
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message,
        conflictingPeriod: {
          id: overlapping.id,
          startDate: overlapping.startDate,
          endDate: overlapping.endDate,
        },
      });
    }

    // CA1: El periodo queda disponible para reservas.
    const createdPeriod: AvailabilityPeriodResponseDto = {
      id: randomUUID(),
      listingId,
      startDate,
      endDate,
      availableForBooking: true,
      createdAt: new Date(),
    };

    this.availabilityPeriodsStore.push(createdPeriod);
    this.recordAvailabilityChange(
      host?.email,
      listingId,
      AuditResult.EXITOSO,
      `Periodo disponible registrado: ${startDate} al ${endDate}`,
    );
    return createdPeriod;
  }

  /**
   * HU-015 · Consultar la tarifa de limpieza y el descuento por estancia larga de una publicación propia.
   */
  getPricing(listingId: string, host?: ActiveSession): ListingPricingResponseDto {
    this.findOwnListing(listingId, host);
    return this.toPricing(this.listingsStore.find((item) => item.id === listingId)!);
  }

  /**
   * HU-015 · Definir limpieza y descuento por estancia larga (CA1, CA2, CA3, RF-019, RN-004, RN-013).
   * Solo el anfitrión dueño define los valores (RN-005). La tarifa de limpieza debe ser >= 0 COP (CA1) y
   * el descuento estar entre 0 % y 50 % a partir de al menos 1 noche (CA2); fuera de rango se rechaza (CA3).
   * Los cambios aplican a las cotizaciones nuevas; cada intento queda en la auditoría (RN-021).
   */
  updatePricing(listingId: string, dto: UpdateListingPricingDto, host?: ActiveSession): ListingPricingResponseDto {
    const fail = (detail: string) =>
      this.recordPricingChange(host?.email, listingId, AuditResult.FALLIDO, `Tarifas rechazadas: ${detail}`);

    this.findOwnListing(listingId, host, fail);
    const listing = this.listingsStore.find((item) => item.id === listingId)!;

    const fieldErrors = validateListingPricing(dto);
    if (Object.keys(fieldErrors).length > 0) {
      const message = Object.values(fieldErrors).join(' ');
      fail(message);
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message, fieldErrors });
    }

    const percentage = Number(dto.longStayDiscountPercent ?? 0);
    listing.cleaningFee = roundMoney(Number(dto.cleaningFee));
    listing.longStayDiscount =
      percentage > 0 ? { minNights: Number(dto.longStayMinNights), percentage: roundMoney(percentage) } : undefined;

    const pricing = this.toPricing(listing);
    const discountDetail = pricing.longStayDiscount
      ? `${pricing.longStayDiscount.percentage} % desde ${pricing.longStayDiscount.minNights} noche(s)`
      : 'sin descuento';
    this.recordPricingChange(
      host?.email,
      listingId,
      AuditResult.EXITOSO,
      `Tarifa de limpieza: ${pricing.cleaningFee} COP; descuento por estancia larga: ${discountDetail}`,
    );
    return pricing;
  }

  /**
   * HU-015, HU-027 y HU-028: datos de la publicación que usa la cotización (precio, limpieza, descuento,
   * servicios adicionales y capacidad). Retorna undefined si la publicación no está registrada.
   */
  getQuotePricing(
    listingId: string,
  ): {
    pricePerNight?: number;
    cleaningFee: number;
    longStayDiscount?: LongStayDiscountDto;
    additionalServices: AdditionalServiceDto[];
    maxGuests?: number;
  } | undefined {
    const listing = this.listingsStore.find((item) => item.id === listingId);
    if (!listing) {
      return undefined;
    }
    return {
      pricePerNight: listing.pricePerNight,
      cleaningFee: listing.cleaningFee ?? 0,
      longStayDiscount: listing.longStayDiscount ? { ...listing.longStayDiscount } : undefined,
      additionalServices: (listing.additionalServices ?? []).map((service) => ({ ...service })),
      maxGuests: listing.maxGuests,
    };
  }

  /**
   * HU-028 CA3 (RF-030, RF-039): noches del rango [llegada, salida) que no se pueden reservar, porque están
   * fuera de los periodos disponibles o reservadas o bloqueadas. Lista vacía = el rango está disponible.
   */
  unavailableNights(listingId: string, checkIn: string, checkOut: string): string[] {
    if (this.isRangeAvailable(listingId, checkIn, checkOut)) {
      return [];
    }
    const periods = this.periodsOf(listingId);
    const blocked = this.blockedNightsSetOf(listingId);
    const nights = nightsInInterval(checkIn, checkOut);
    const unavailable = nights.filter(
      (night) => blocked.has(night) || !periods.some((period) => night >= period.startDate && night < period.endDate),
    );
    return unavailable.length > 0 ? unavailable : nights;
  }

  private toPricing(listing: ListingResponseDto): ListingPricingResponseDto {
    return {
      listingId: listing.id,
      cleaningFee: listing.cleaningFee ?? 0,
      longStayDiscount: listing.longStayDiscount ? { ...listing.longStayDiscount } : null,
      currency: 'COP',
    };
  }

  private recordPricingChange(
    actor: string | undefined,
    listingId: string,
    result: AuditResult,
    detail: string,
  ): void {
    this.auditService.record({
      actor,
      action: AuditAction.LISTING_PRICING_UPDATE,
      entity: 'Listing',
      entityId: listingId,
      result,
      detail,
    });
  }

  /** HU-019: periodos del alojamiento, visibles solo para su anfitrión. */
  getAvailabilityPeriods(listingId: string, host?: ActiveSession): AvailabilityPeriodResponseDto[] {
    this.findOwnListing(listingId, host);
    return this.periodsOf(listingId);
  }

  /**
   * HU-023 · Bloquear automáticamente el periodo reservado (CA1, CA2, CA3, RF-029, RF-030, RN-011, RN-028).
   * Al registrar la confirmación de una reserva en el intervalo [llegada, salida) (AMB-09),
   * las noches dentro de [checkIn, checkOut) dejan de estar disponibles.
   * El día de salida (checkOut) no se bloquea como noche y puede ser la llegada de otra reserva (CA2).
   */
  blockReservedPeriod(
    listingId: string,
    dto: BlockReservedPeriodDto,
    actor?: string,
    guestId?: string,
    type: 'RESERVA' | 'BLOQUEO' = 'RESERVA',
  ): BlockedPeriodResponseDto {
    const fail = (detail: string) =>
      this.recordReservedBlockChange(actor, listingId, AuditResult.FALLIDO, `Bloqueo rechazado: ${detail}`);

    let checkIn: string;
    let checkOut: string;
    try {
      checkIn = this.normalizeDateOnly(dto?.checkIn ?? dto?.startDate ?? '');
      checkOut = this.normalizeDateOnly(dto?.checkOut ?? dto?.endDate ?? '');
    } catch (error) {
      fail('fechas inválidas');
      throw error;
    }

    if (checkOut <= checkIn) {
      const message = 'La fecha de salida debe ser posterior a la fecha de llegada.';
      fail(message);
      throw new BadRequestException(message);
    }

    const nights = nightsInInterval(checkIn, checkOut);
    const periods = this.periodsOf(listingId);
    if (periods.length > 0 && !this.areNightsCoveredByPeriods(nights, periods)) {
      const message = 'El periodo reservado está fuera de los periodos disponibles del alojamiento.';
      fail(message);
      throw new BadRequestException(message);
    }

    const alreadyBlockedSet = this.blockedNightsSetOf(listingId);
    const conflictingNights = nights.filter((night) => alreadyBlockedSet.has(night));
    if (conflictingNights.length > 0) {
      const message = `No se puede bloquear el periodo: las noches ${conflictingNights.join(', ')} ya están reservadas o bloqueadas.`;
      fail(message);
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message,
        blockedDates: conflictingNights,
      });
    }

    const blocked: BlockedPeriodResponseDto = {
      id: randomUUID(),
      listingId,
      bookingId: dto?.bookingId?.trim() || undefined,
      type,
      checkIn,
      checkOut,
      blockedNights: nights,
      createdAt: new Date(),
    };

    this.reservedPeriodsStore.push(blocked);
    if (guestId) {
      this.guestsWithReservations.add(`${listingId}|${guestId}`);
    }
    this.recordReservedBlockChange(
      actor,
      listingId,
      AuditResult.EXITOSO,
      `Periodo reservado bloqueado [${checkIn}, ${checkOut}): noches ${nights.join(', ')}`,
    );
    return blocked;
  }

  /** HU-023: lista los periodos reservados/bloqueados de un alojamiento. */
  getReservedPeriods(listingId: string): BlockedPeriodResponseDto[] {
    return this.reservedPeriodsOf(listingId);
  }

  private periodsOf(listingId: string): AvailabilityPeriodResponseDto[] {
    return this.availabilityPeriodsStore
      .filter((period) => period.listingId === listingId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  private reservedPeriodsOf(listingId: string): BlockedPeriodResponseDto[] {
    return this.reservedPeriodsStore
      .filter((period) => period.listingId === listingId)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  }

  private blockedNightsSetOf(listingId: string): Set<string> {
    const blocked = new Set<string>();
    for (const period of this.reservedPeriodsOf(listingId)) {
      for (const night of period.blockedNights) {
        blocked.add(night);
      }
    }
    return blocked;
  }

  private areNightsCoveredByPeriods(nights: string[], periods: AvailabilityPeriodResponseDto[]): boolean {
    return nights.every((night) => periods.some((p) => night >= p.startDate && night < p.endDate));
  }

  /** Responde 404 si el alojamiento no existe o es de otro anfitrión, sin revelar cuál de los dos ocurre. */
  private findOwnListing(listingId: string, host?: ActiveSession, onFail?: (detail: string) => void): void {
    const listing = this.listingsStore.find((item) => item.id === listingId);
    const ownerId = host?.userId;
    if (!ownerId || listing?.hostId !== ownerId) {
      onFail?.('alojamiento no encontrado o de otro anfitrión');
      throw new NotFoundException(`Publicación con id ${listingId} no encontrada`);
    }
  }

  private recordAvailabilityChange(
    actor: string | undefined,
    listingId: string,
    result: AuditResult,
    detail: string,
  ): void {
    this.auditService.record({
      actor,
      action: AuditAction.AVAILABILITY_PERIOD_CREATE,
      entity: 'Listing',
      entityId: listingId,
      result,
      detail,
    });
  }

  private recordReservedBlockChange(
    actor: string | undefined,
    listingId: string,
    result: AuditResult,
    detail: string,
  ): void {
    this.auditService.record({
      actor,
      action: AuditAction.RESERVED_PERIOD_BLOCK,
      entity: 'Listing',
      entityId: listingId,
      result,
      detail,
    });
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

  /**
   * HU-024 CA3 (RN-010): las fechas son opcionales (CA4), pero si se indica una se exigen
   * ambas y la salida debe ser posterior a la llegada.
   */
  private parseStayDates(checkIn?: string, checkOut?: string): { checkIn: string; checkOut: string } | undefined {
    if (!checkIn && !checkOut) {
      return undefined;
    }
    if (!checkIn || !checkOut) {
      throw new BadRequestException('Indica la fecha de llegada y la fecha de salida, o ninguna de las dos');
    }
    const stay = { checkIn: this.normalizeDateOnly(checkIn), checkOut: this.normalizeDateOnly(checkOut) };
    if (stay.checkOut <= stay.checkIn) {
      throw new BadRequestException('La fecha de salida debe ser posterior a la fecha de llegada');
    }
    return stay;
  }

  /**
   * RF-030: un rango está disponible solo si cae dentro de un periodo disponible registrado;
   * sin periodos no hay disponibilidad. El día de salida no se ocupa, por eso puede ser el fin del periodo.
   * Con HU-023, tampoco puede incluir noches ya reservadas o bloqueadas.
   */
  /**
   * HU-022 · Consultar el calendario de disponibilidad (CA1, CA2, RF-028, RN-028).
   * 12 meses desde el mes actual, noche por noche. El público ve si cada noche está disponible (CA1) y solo
   * para publicaciones ACTIVAS; el anfitrión dueño y el administrador distinguen reservadas, bloqueadas y
   * noches fuera de los periodos disponibles (CA2), en cualquier estado de la publicación.
   */
  getCalendar(listingId: string, rawToken?: string): ListingCalendarDto {
    const listing = this.listingsStore.find((item) => item.id === listingId);
    const session = this.authService?.getSession(rawToken);
    const isManager = Boolean(
      listing && session && (session.userId === listing.hostId || session.role === Role.ADMINISTRADOR),
    );
    if (!listing || (listing.status !== ListingStatus.ACTIVA && !isManager)) {
      throw new NotFoundException(LISTING_NOT_AVAILABLE);
    }

    const today = this.getTodayDateOnly();
    const periods = this.periodsOf(listingId);
    const occupied = new Map<string, 'RESERVADA' | 'BLOQUEADA'>();
    for (const period of this.reservedPeriodsOf(listingId)) {
      const status = period.type === 'BLOQUEO' ? 'BLOQUEADA' : 'RESERVADA';
      period.blockedNights.forEach((night) => occupied.set(night, status));
    }

    const hostStatus = (date: string): CalendarDayStatus => {
      if (date < today) {
        return 'PASADA';
      }
      const occupation = occupied.get(date);
      if (occupation) {
        return occupation;
      }
      return periods.some((period) => date >= period.startDate && date < period.endDate) ? 'DISPONIBLE' : 'SIN_PERIODO';
    };
    const publicStatus = (date: string): CalendarDayStatus => {
      const status = hostStatus(date);
      return status === 'DISPONIBLE' || status === 'PASADA' ? status : 'NO_DISPONIBLE';
    };
    const statusOf = isManager ? hostStatus : publicStatus;

    const [year, month] = today.split('-').map(Number);
    const months: CalendarMonthDto[] = Array.from({ length: 12 }, (_, offset) => {
      const first = new Date(Date.UTC(year, month - 1 + offset, 1));
      const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const prefix = first.toISOString().slice(0, 7);
      return {
        month: prefix,
        days: Array.from({ length: daysInMonth }, (_day, index) => {
          const date = `${prefix}-${String(index + 1).padStart(2, '0')}`;
          return { date, status: statusOf(date) };
        }),
      };
    });

    const lastMonth = months[months.length - 1];
    return {
      listingId,
      view: isManager ? 'ANFITRION' : 'PUBLICA',
      today,
      from: months[0].days[0].date,
      to: lastMonth.days[lastMonth.days.length - 1].date,
      months,
    };
  }

  private isRangeAvailable(listingId: string, checkIn: string, checkOut: string): boolean {
    const withinPeriods = this.periodsOf(listingId).some((period) => checkIn >= period.startDate && checkOut <= period.endDate);
    if (!withinPeriods) {
      return false;
    }
    const requestedNights = nightsInInterval(checkIn, checkOut);
    const blockedSet = this.blockedNightsSetOf(listingId);
    return !requestedNights.some((night) => blockedSet.has(night));
  }

  /**
   * HU-024 · Buscar por ciudad, fechas y huéspedes (CA1-CA4, RF-031, RF-033).
   * Solo publicaciones ACTIVAS (RN-006) con capacidad suficiente y, si se indican
   * fechas, disponibles en toda la estadía (RF-030).
   */
  async search(searchDto: SearchListingsDto): Promise<PaginatedListingsResponseDto> {
    const stay = this.parseStayDates(searchDto.checkIn, searchDto.checkOut);
    const city = searchDto.city?.trim() ? normalizeCity(searchDto.city) : undefined;

    const filtered = this.listingsStore.filter(
      (item) =>
        item.status === ListingStatus.ACTIVA &&
        (!city || normalizeCity(item.city ?? '') === city) &&
        (!searchDto.guests || (item.maxGuests ?? 0) >= searchDto.guests) &&
        (!stay || this.isRangeAvailable(item.id, stay.checkIn, stay.checkOut)),
    );

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

  /**
   * HU-026 · Consultar el detalle de una publicación (CA1, CA2, RF-034, RN-006).
   * Cualquiera ve el detalle de una publicación ACTIVA. Si no está ACTIVA, solo la ven su anfitrión,
   * el administrador y los huéspedes con reservas en ella (AMB-39); los demás reciben 404.
   */
  getListingDetail(id: string, rawToken?: string): ListingDetailDto {
    const listing = this.listingsStore.find((item) => item.id === id);
    const session = this.authService?.getSession(rawToken);
    if (!listing || !this.canViewDetail(listing, session)) {
      throw new NotFoundException(LISTING_NOT_AVAILABLE);
    }
    return toListingDetail(listing);
  }

  private canViewDetail(listing: ListingResponseDto, session?: ActiveSession): boolean {
    if (listing.status === ListingStatus.ACTIVA) {
      return true;
    }
    if (!session) {
      return false;
    }
    return (
      session.userId === listing.hostId ||
      session.role === Role.ADMINISTRADOR ||
      this.guestsWithReservations.has(`${listing.id}|${session.userId}`)
    );
  }

  /**
   * HU-019 y HU-023 (CA1, CA2, CA3, RF-029, RF-030, RN-011, RN-028):
   * Evalúa la disponibilidad de un alojamiento en el intervalo de noches [startDate, endDate) (AMB-09).
   * - CA1: Las noches de una reserva confirmada dejan de estar disponibles.
   * - CA2: El día de salida (endDate de una reserva previa) puede ser la llegada (startDate) de otra reserva.
   * - CA3: Si el rango consultado incluye al menos una noche reservada o bloqueada, retorna isAvailable = false.
   */
  getAvailability(id: string, query: CheckAvailabilityQueryDto): AvailabilityResponseDto {
    const startDate = this.normalizeDateOnly(query?.startDate);
    const endDate = this.normalizeDateOnly(query?.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('La fecha de salida debe ser posterior a la fecha de llegada.');
    }

    const requestedNights = nightsInInterval(startDate, endDate);
    const periods = this.periodsOf(id);
    const reservedPeriods = this.reservedPeriodsOf(id);
    const blockedSet = this.blockedNightsSetOf(id);

    const blockedDates = requestedNights.filter((night) => blockedSet.has(night));
    const withinRegisteredPeriods =
      periods.length > 0 ? this.areNightsCoveredByPeriods(requestedNights, periods) : false;
    const isAvailable = withinRegisteredPeriods && blockedDates.length === 0;

    return {
      listingId: id,
      isAvailable,
      blockedDates,
      pricePerNight: 90,
      availablePeriods: periods,
      reservedPeriods,
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
