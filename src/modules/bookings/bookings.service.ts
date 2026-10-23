import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditService } from '../audit/audit.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingsService } from '../listings/listings.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { DEFAULT_SERVICE_FEE_PERCENT } from '../platform/dto/service-fee.dto';
import { randomUUID } from 'node:crypto';

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
  ) {}

  onModuleInit(): void {
    this.persistence?.register('bookings', {
      dump: () => this.bookingsStore,
      restore: (data) => {
        this.bookingsStore = data as BookingResponseDto[];
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

  async createInstant(bookingDto: CreateBookingDto, actor?: string): Promise<BookingResponseDto> {
    const booking: BookingResponseDto = {
      id: `booking-${randomUUID()}`,
      listingId: bookingDto.listingId,
      guestId: 'mock-guest-uuid',
      checkIn: bookingDto.checkIn,
      checkOut: bookingDto.checkOut,
      guests: bookingDto.guests,
      serviceFee: 55.50,
      totalAmount: 518.00,
      currency: 'USD',
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

    return booking;
  }

  /**
   * HU-023 · Al registrar la confirmación de una reserva, bloquea automáticamente
   * las noches del intervalo [checkIn, checkOut) (AMB-09) en el alojamiento (CA1, CA2, CA3).
   */
  async confirmBooking(id: string, actor?: string): Promise<BookingResponseDto> {
    const booking = this.bookingsStore.find((item) => item.id === id);
    if (!booking) {
      throw new NotFoundException(`Reserva con id ${id} no encontrada`);
    }

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
