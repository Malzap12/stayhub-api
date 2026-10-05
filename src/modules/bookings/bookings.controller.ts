import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';

@ApiTags('Reservas')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('quote')
  @ApiOperation({ summary: 'Cotizar estancia calculando noches, tarifas y total' })
  quote(@Body() quoteData: any) {
    return this.bookingsService.quote(quoteData);
  }

  @Post('instant')
  @ApiOperation({ summary: 'Crear reserva inmediata garantizando idempotencia y no overbooking' })
  createInstant(@Body() bookingData: any) {
    return this.bookingsService.createInstant(bookingData);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar estado de reserva' })
  findOne(@Param('id') id: string) {
    return this.bookingsService.findOne(id);
  }
}
