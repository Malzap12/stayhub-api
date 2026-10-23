import { Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditService } from '../audit/audit.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingsService } from '../listings/listings.service';
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
   * Cotiza una estancia. HU-015 (CA1, CA2, RF-019, RN-004, RN-013): usa la tarifa de limpieza vigente de la
   * publicaciÃ³n y aplica su descuento por estancia larga cuando las noches alcanzan el mÃ­nimo definido.
   * Si la publicaciÃ³n no estÃ¡ registrada conserva los valores de demostraciÃ³n.
   */
  async quote(quoteDto: QuoteBookingDto): Promise<QuoteResponseDto> {
    const checkIn = new Date(quoteDto.checkIn);
    const checkOut = new Date(quoteDto.checkOut);
    const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
    const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const round = (value: number) => Math.round(value * 100) / 100;

    const pricing = this.listingsService?.getQuotePricing(quoteDto.listingId);
    const nightlyRate = pricing?.pricePerNight ?? 85.50;
    const baseAmount = round(nights * nightlyRate);
    const cleaningFee = pricing ? pricing.cleaningFee : 35.00;
    const longStay = pricing?.longStayDiscount;
    const discountPercentage = longStay && nights >= longStay.minNights ? longStay.percentage : 0;
    const discount = round((baseAmount * discountPercentage) / 100);
    const serviceFee = round((baseAmount - discount) * 0.12);
    const totalAmount = round(baseAmount - discount + cleaningFee + serviceFee);

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
      serviceFee,
      totalAmount,
      currency: pricing ? 'COP' : 'USD',
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
      totalAmount: 518.00,
      currency: 'USD',
      status: BookingStatus.CONFIRMADA,
      idempotencyKey: 'sample-idempotency-key',
      createdAt: new Date(),
    };
  }
}
