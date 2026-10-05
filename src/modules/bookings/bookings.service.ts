import { Injectable } from '@nestjs/common';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { BookingStatus } from '../../common/enums/booking-status.enum';

@Injectable()
export class BookingsService {
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

  async createInstant(bookingDto: CreateBookingDto): Promise<BookingResponseDto> {
    return {
      id: 'mock-booking-uuid-1',
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
  }

  async findOne(id: string): Promise<BookingResponseDto> {
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
