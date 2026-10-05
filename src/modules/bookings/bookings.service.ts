import { Injectable } from '@nestjs/common';

@Injectable()
export class BookingsService {
  async quote(quoteData: any) {
    const basePrice = quoteData.pricePerNight * quoteData.nights;
    const cleaningFee = 50000;
    const serviceFee = basePrice * 0.10;
    return {
      nights: quoteData.nights,
      basePrice,
      cleaningFee,
      serviceFee,
      total: basePrice + cleaningFee + serviceFee,
    };
  }

  async createInstant(bookingData: any) {
    return { message: 'Reserva confirmada con éxito', bookingId: 'bkg-12345', status: 'CONFIRMADA' };
  }

  async findOne(id: string) {
    return { id, status: 'CONFIRMADA' };
  }
}
