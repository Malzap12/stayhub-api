import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { ListingsService } from '../listings/listings.service';
import { randomUUID } from 'node:crypto';

@Injectable()
export class BookingsService {
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
  ) {}

  async quote(quoteDto: QuoteBookingDto): Promise<QuoteResponseDto> {
    const checkIn = new Date(quoteDto.checkIn);
    const checkOut = new Date(quoteDto.checkOut);
    const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
    const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const nightlyRate = 85.50;
    const baseAmount = nights * nightlyRate;
    const cleaningFee = 35.00;
    const serviceFee = parseFloat((baseAmount * 0.12).toFixed(2));
    const totalAmount = parseFloat((baseAmount + cleaningFee + serviceFee).toFixed(2));

    return {
      listingId: quoteDto.listingId,
      checkIn: quoteDto.checkIn,
      checkOut: quoteDto.checkOut,
      nights,
      nightlyRate,
      baseAmount,
      cleaningFee,
      serviceFee,
      totalAmount,
      currency: 'USD',
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
