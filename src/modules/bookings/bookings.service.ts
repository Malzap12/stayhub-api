import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingPaymentResultDto, BookingResponseDto } from './dto/booking-response.dto';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditService } from '../audit/audit.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { DEFAULT_SERVICE_FEE_PERCENT } from '../platform/dto/service-fee.dto';
import { randomBytes, randomUUID } from 'node:crypto';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { PaymentsService } from '../payments/payments.service';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { PaymentStatus } from '../../common/enums/payment-status.enum';

@Injectable()
export class BookingsService implements OnModuleInit {
  private bookingsStore: BookingResponseDto[] = [
    {
      id: 'mock-booking-uuid-1',
      listingId: 'mock-listing-uuid-1',
      guestId: 'mock-guest-uuid',
      checkIn: '2026-11-01',
      checkOut: '2026-11-06',
      guests: 2,
      totalAmount: 518.0,
      serviceFee: 55.50,
      currency: 'USD',
      status: BookingStatus.CONFIRMADA,
      idempotencyKey: 'sample-idempotency-key',
      createdAt: new Date(),
    },
  ];

  constructor(
    private readonly auditService: AuditService,
    @Optional() private readonly listingsService?: ListingsService,
    @Optional() private readonly persistence?: StatePersistenceService,
    @Optional() private readonly platformConfigService?: PlatformConfigService,
    @Optional() private readonly paymentsService?: PaymentsService,
  ) {}

  /** HU-031 · Cola de pagos y confirmaciones por alojamiento: se procesan de a una (CA2, RN-011, RNF-010). */
  private readonly listingLocks = new Map<string, Promise<unknown>>();
  /** HU-032 · Solicitudes de reserva en curso por clave de idempotencia, para que un doble clic no cree otra. */
  private readonly bookingsInProgress = new Map<string, Promise<BookingResponseDto>>();

  onModuleInit(): void {
    this.persistence?.register('bookings', {
      dump: () => this.bookingsStore,
      restore: (data) => {
        this.bookingsStore = (data as BookingResponseDto[]) ?? [];
      },
    });
  }

  /**
   * HU-027 · Cotizar una estancia (CA1-CA4, RF-036 a RF-038, RN-019, RN-020).
   * total = (precio base − descuento) + limpieza + servicios adicionales + tarifa de servicio, donde la tarifa de
   * servicio es el porcentaje configurado (HU-029) sobre esa suma. El descuento por estancia larga y la limpieza
   * son los vigentes de la publicación (HU-015). Todos los importes en COP.
   */
  /**
   * HU-028 · Validar la solicitud de cotización (CA1, CA2, CA3, RF-039, RN-010, RN-011, RN-033).
   * Rechaza, en este orden, la salida no posterior a la llegada, más huéspedes que la capacidad y un periodo
   * no disponible. Cada rechazo indica el motivo (`reason`) y el dato necesario para corregirlo.
   */
  private validateQuoteRequest(
    listingId: string,
    checkIn: string,
    checkOut: string,
    nights: number,
    guests: number,
    maxGuests?: number,
  ): void {
    if (!Number.isFinite(nights) || nights < 1) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'FECHAS_INVALIDAS',
        message: 'La fecha de salida debe ser posterior a la fecha de llegada',
      });
    }
    if (maxGuests != null && guests > maxGuests) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'CAPACIDAD_EXCEDIDA',
        message: `Esta publicación admite máximo ${maxGuests} ${maxGuests === 1 ? 'huésped' : 'huéspedes'}`,
        maxGuests,
      });
    }
    const unavailableNights = this.listingsService?.unavailableNights(listingId, checkIn, checkOut) ?? [];
    if (unavailableNights.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'PERIODO_NO_DISPONIBLE',
        message: `El periodo del ${checkIn} al ${checkOut} no está disponible en esta publicación`,
        unavailableNights,
      });
    }
  }

  async quote(quoteDto: QuoteBookingDto): Promise<QuoteResponseDto> {
    const pricing = this.listingsService?.getQuotePricing(quoteDto.listingId);
    if (!pricing || pricing.pricePerNight == null) {
      throw new NotFoundException('Esta publicación no está disponible para cotizar');
    }

    const checkIn = String(quoteDto.checkIn).slice(0, 10);
    const checkOut = String(quoteDto.checkOut).slice(0, 10);
    const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
    this.validateQuoteRequest(quoteDto.listingId, checkIn, checkOut, nights, Number(quoteDto.guests), pricing.maxGuests);

    const requested = [...new Set((quoteDto.additionalServices ?? []).map((name) => name.trim()).filter(Boolean))];
    const additionalServices = requested.map((name) => {
      const service = pricing.additionalServices.find((item) => item.name === name);
      if (!service) {
        throw new BadRequestException(`El servicio adicional «${name}» no está disponible en esta publicación`);
      }
      return { name: service.name, cost: service.cost };
    });

    const round = (value: number) => Math.round(value * 100) / 100;
    const nightlyRate = pricing.pricePerNight;
    const baseAmount = round(nights * nightlyRate);
    const longStay = pricing.longStayDiscount;
    const discountPercentage = longStay && nights >= longStay.minNights ? longStay.percentage : 0;
    const discount = round((baseAmount * discountPercentage) / 100);
    const cleaningFee = pricing.cleaningFee;
    const additionalServicesTotal = round(additionalServices.reduce((sum, service) => sum + service.cost, 0));
    const subtotal = round(baseAmount - discount + cleaningFee + additionalServicesTotal);
    const serviceFeePercentage = this.platformConfigService?.getServiceFeePercent() ?? DEFAULT_SERVICE_FEE_PERCENT;
    const serviceFee = round((subtotal * serviceFeePercentage) / 100);
    const totalAmount = round(subtotal + serviceFee);

    return {
      listingId: quoteDto.listingId,
      checkIn: quoteDto.checkIn,
      checkOut: quoteDto.checkOut,
      nights,
      nightlyRate,
      baseAmount,
      discountPercentage,
      discount,
      cleaningFee,
      additionalServices,
      additionalServicesTotal,
      subtotal,
      serviceFeePercentage,
      serviceFee,
      totalAmount,
      currency: 'COP',
    };
  }

  /**
   * HU-030 · Reservar de forma inmediata (CA1, CA2, CA3, CA4 · RF-041, RF-045, RF-046, RN-006, RN-015, RNF-008).
   * Reserva inmediata para publicaciones activas. Si la publicación no está activa, rechaza la reserva (CA3).
   * Conserva el desglose de precios y tarifas vigente al confirmar (CA2). Si se incluye tarjeta de prueba,
   * procesa el pago y si se aprueba confirma la reserva con su código y desglose (CA1).
   */
  /**
   * HU-032 · Evitar reservas duplicadas por reintentos (CA1, CA2 · RF-044, RN-018).
   * Una solicitud con una clave de idempotencia ya usada devuelve la reserva original, sin crear otra ni repetir
   * el cobro simulado, también si llega mientras la original se está procesando (doble clic). Una clave nueva se
   * procesa como una reserva nueva. La clave solo sirve a quien la usó y para la misma estancia.
   */
  async createInstant(bookingDto: CreateBookingDto, actor?: string): Promise<BookingResponseDto> {
    const key = bookingDto.idempotencyKey;
    const existing = this.bookingsStore.find((item) => item.idempotencyKey === key);
    if (existing) {
      return this.replayBooking(existing, bookingDto, actor);
    }
    const inProgress = this.bookingsInProgress.get(key);
    if (inProgress !== undefined) {
      return this.replayBooking(await inProgress, bookingDto, actor);
    }

    const creation = this.createNewBooking(bookingDto, actor);
    this.bookingsInProgress.set(key, creation);
    try {
      return await creation;
    } finally {
      this.bookingsInProgress.delete(key);
    }
  }

  private replayBooking(booking: BookingResponseDto, bookingDto: CreateBookingDto, actor?: string): BookingResponseDto {
    if (booking.guestId !== (actor ?? 'mock-guest-uuid')) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        reason: 'CLAVE_IDEMPOTENCIA_EN_USO',
        message: 'La clave de idempotencia ya fue usada en otra solicitud; genera una clave nueva para esta reserva',
      });
    }
    const sameStay =
      booking.listingId === bookingDto.listingId &&
      String(booking.checkIn).slice(0, 10) === String(bookingDto.checkIn).slice(0, 10) &&
      String(booking.checkOut).slice(0, 10) === String(bookingDto.checkOut).slice(0, 10) &&
      Number(booking.guests) === Number(bookingDto.guests);
    if (!sameStay) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        reason: 'CLAVE_IDEMPOTENCIA_REUTILIZADA',
        message: 'La clave de idempotencia ya se usó para otra estancia; usa una clave nueva para reservar otra estancia',
      });
    }

    this.auditService.record({
      actor,
      action: AuditAction.BOOKING_STATUS_CHANGE,
      entity: 'Booking',
      entityId: booking.id,
      result: AuditResult.EXITOSO,
      detail: `Reintento con la misma clave de idempotencia: se devuelve la reserva ${booking.status} sin crear otra ni cobrar de nuevo`,
    });
    return booking;
  }

  private async createNewBooking(bookingDto: CreateBookingDto, actor?: string): Promise<BookingResponseDto> {
    const listing = this.listingsService?.getListing(bookingDto.listingId);
    if (listing && listing.status !== ListingStatus.ACTIVA) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        reason: 'PUBLICACION_NO_ACTIVA',
        message: 'Solo se pueden reservar publicaciones activas',
      });
    }

    let quoteData: QuoteResponseDto | undefined;
    try {
      quoteData = await this.quote({
        listingId: bookingDto.listingId,
        checkIn: bookingDto.checkIn,
        checkOut: bookingDto.checkOut,
        guests: bookingDto.guests,
        additionalServices: bookingDto.additionalServices,
      });
    } catch (error) {
      if (listing && error instanceof BadRequestException) { throw error; }
    }

    const bookingCode = `RES-${randomBytes(4).toString('hex').toUpperCase()}`;
    const booking: BookingResponseDto = {
      id: `booking-${randomUUID()}`,
      code: bookingCode,
      listingId: bookingDto.listingId,
      guestId: actor ?? 'mock-guest-uuid',
      checkIn: bookingDto.checkIn,
      checkOut: bookingDto.checkOut,
      guests: bookingDto.guests,
      nights: quoteData?.nights,
      nightlyRate: quoteData?.nightlyRate,
      baseAmount: quoteData?.baseAmount,
      discountPercentage: quoteData?.discountPercentage,
      discount: quoteData?.discount,
      cleaningFee: quoteData?.cleaningFee,
      additionalServices: quoteData?.additionalServices,
      additionalServicesTotal: quoteData?.additionalServicesTotal,
      subtotal: quoteData?.subtotal,
      serviceFeePercentage: quoteData?.serviceFeePercentage,
      serviceFee: quoteData?.serviceFee ?? 55.50,
      totalAmount: quoteData?.totalAmount ?? 518.00,
      currency: quoteData?.currency ?? 'COP',
      breakdown: quoteData,
      status: BookingStatus.PENDIENTE,
      idempotencyKey: bookingDto.idempotencyKey,
      specialRequests: bookingDto.specialRequests,
      createdAt: new Date(),
    };

    this.bookingsStore.push(booking);

    this.auditService.record({
      actor,
      action: AuditAction.BOOKING_STATUS_CHANGE,
      entity: 'Booking',
      entityId: booking.id,
      result: AuditResult.EXITOSO,
      detail: `Reserva creada en estado ${booking.status}`,
    });

    if (bookingDto.card) {
      const payResult = await this.payBooking(booking.id, bookingDto.card, actor);
      return payResult.booking;
    }

    return booking;
  }

  /**
   * HU-023 · Al registrar la confirmación de una reserva, bloquea automáticamente
   * las noches del intervalo [checkIn, checkOut) (AMB-09) en el alojamiento (CA1, CA2, CA3).
   * HU-031 · Antes de confirmar verifica de nuevo la disponibilidad (CA1, RF-042, RN-012) y, como el pago,
   * espera su turno en la cola del alojamiento (CA2). Confirmar una reserva ya CONFIRMADA la devuelve igual.
   */
  async confirmBooking(id: string, actor?: string): Promise<BookingResponseDto> {
    const booking = this.findBookingOrFail(id);
    return this.withListingLock(booking.listingId, async () => {
      if (booking.status === BookingStatus.CONFIRMADA) {
        return booking;
      }
      this.ensureConfirmable(booking);
      this.ensureStillAvailable(booking, actor);
      return this.confirmWithinLock(booking, actor);
    });
  }

  private confirmWithinLock(booking: BookingResponseDto, actor?: string): BookingResponseDto {
    this.listingsService?.blockReservedPeriod(
      booking.listingId,
      {
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        bookingId: booking.id,
      },
      actor,
    );

    booking.status = BookingStatus.CONFIRMADA;
    booking.code ||= `RES-${randomBytes(4).toString('hex').toUpperCase()}`;
    this.auditService.record({
      actor,
      action: AuditAction.BOOKING_STATUS_CHANGE,
      entity: 'Booking',
      entityId: booking.id,
      result: AuditResult.EXITOSO,
      detail: `Reserva confirmada (${booking.checkIn} al ${booking.checkOut}) y noches bloqueadas`,
    });

    return booking;
  }

  /**
   * HU-037 · Pagar la reserva en modo de pruebas (CA1, CA2, CA3 · RF-051, RF-052, RN-022).
   * El pago ocurre dentro de la confirmación: si el proveedor lo aprueba, la reserva queda CONFIRMADA y se
   * bloquean sus noches (HU-023); si lo rechaza, la reserva sigue PENDIENTE y las fechas no se bloquean.
   *
   * HU-031 · Verificar la disponibilidad al confirmar (CA1, CA2 · RF-042, RF-043, RN-011, RN-012, RNF-009, RNF-010).
   * La verificación, el cobro y el bloqueo de noches ocurren en el turno del alojamiento, sin intercalarse con
   * otro pago o confirmación: si otra reserva tomó el periodo, se rechaza sin cobrar; con solicitudes
   * simultáneas sobre el mismo periodo, como máximo una queda CONFIRMADA. Si el bloqueo falla después de un
   * pago aprobado, el pago se revierte y la reserva sigue PENDIENTE (atomicidad).
   */
  async payBooking(id: string, card: PaymentCardDto, actor?: string): Promise<BookingPaymentResultDto> {
    const booking = this.findBookingOrFail(id);
    return this.withListingLock(booking.listingId, async () => {
      if (booking.status === BookingStatus.CONFIRMADA) {
        throw new ConflictException('La reserva ya está confirmada y pagada');
      }
      if (booking.status !== BookingStatus.PENDIENTE) {
        throw new BadRequestException(`Solo se pueden pagar reservas pendientes (estado actual: ${booking.status})`);
      }
      if (!this.paymentsService) {
        throw new ServiceUnavailableException('El proveedor de pagos no está disponible');
      }

      // Se verifica la disponibilidad antes de cobrar para no aprobar un pago de una reserva que no se puede confirmar.
      this.ensureStillAvailable(booking, actor);

      const payment = await this.paymentsService.charge({
        bookingId: booking.id,
        amount: booking.totalAmount,
        currency: booking.currency,
        card,
      });
      booking.payment = payment;

      if (payment.status === PaymentStatus.APROBADO) {
        try {
          this.confirmWithinLock(booking, actor);
        } catch (error) {
          booking.payment = this.paymentsService.revert(payment);
          this.recordConfirmationFailure(
            booking,
            actor,
            `el pago ${payment.reference} se revirtió porque no se pudieron bloquear las noches`,
          );
          throw error;
        }
      } else {
        this.auditService.record({
          actor,
          action: AuditAction.BOOKING_STATUS_CHANGE,
          entity: 'Booking',
          entityId: booking.id,
          result: AuditResult.FALLIDO,
          detail: `Pago ${payment.reference} rechazado (${payment.declineReason}); la reserva sigue ${booking.status} y las fechas no se bloquean`,
        });
      }

      return { booking, payment: booking.payment };
    });
  }

  private findBookingOrFail(id: string): BookingResponseDto {
    const booking = this.bookingsStore.find((item) => item.id === id);
    if (!booking) {
      throw new NotFoundException(`Reserva con id ${id} no encontrada`);
    }
    return booking;
  }

  private ensureConfirmable(booking: BookingResponseDto): void {
    if (booking.status !== BookingStatus.PENDIENTE) {
      throw new BadRequestException(`Solo se pueden confirmar reservas pendientes (estado actual: ${booking.status})`);
    }
  }

  /** HU-031 CA1: si otra reserva o un bloqueo tomó alguna noche después de la cotización, rechaza sin cobrar. */
  private ensureStillAvailable(booking: BookingResponseDto, actor?: string): void {
    const unavailableNights = this.listingsService?.unavailableNights(booking.listingId, booking.checkIn, booking.checkOut) ?? [];
    if (unavailableNights.length === 0) {
      return;
    }
    this.recordConfirmationFailure(booking, actor, `periodo no disponible (noches ${unavailableNights.join(', ')}); no se hizo el cobro`);
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      reason: 'PERIODO_NO_DISPONIBLE',
      message: `El periodo del ${booking.checkIn} al ${booking.checkOut} ya no está disponible en esta publicación`,
      unavailableNights,
    });
  }

  private recordConfirmationFailure(booking: BookingResponseDto, actor: string | undefined, detail: string): void {
    this.auditService.record({
      actor,
      action: AuditAction.BOOKING_STATUS_CHANGE,
      entity: 'Booking',
      entityId: booking.id,
      result: AuditResult.FALLIDO,
      detail: `Confirmación rechazada: ${detail}`,
    });
  }

  private async withListingLock<T>(listingId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.listingLocks.get(listingId) ?? Promise.resolve();
    const current = previous.then(task);
    const tail = current.catch(() => undefined);
    this.listingLocks.set(listingId, tail);
    try {
      return await current;
    } finally {
      if (this.listingLocks.get(listingId) === tail) {
        this.listingLocks.delete(listingId);
      }
    }
  }

  async findMyBookings(): Promise<BookingResponseDto[]> {
    return this.bookingsStore;
  }

  async findOne(id: string): Promise<BookingResponseDto> {
    const existing = this.bookingsStore.find((item) => item.id === id);
    if (existing) {
      return existing;
    }
    return {
      id,
      listingId: 'mock-listing-uuid-1',
      guestId: 'mock-guest-uuid',
      checkIn: '2026-11-01',
      checkOut: '2026-11-06',
      guests: 2,
      serviceFee: 55.50,
      totalAmount: 518.00,
      currency: 'USD',
      status: BookingStatus.CONFIRMADA,
      idempotencyKey: 'sample-idempotency-key',
      createdAt: new Date(),
    };
  }
}
