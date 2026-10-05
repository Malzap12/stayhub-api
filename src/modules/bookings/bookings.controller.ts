import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

@ApiTags('Reservas y Cotizaciones (Bookings)')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('quote')
  @ApiOperation({ summary: 'Cotizar estancia', description: 'Calcula el desglose completo del costo: noches x tarifa base + tarifa de limpieza + comisión de servicio = total.' })
  @ApiResponse({ status: 200, description: 'Cotización calculada exitosamente', type: QuoteResponseDto })
  @ApiResponse({ status: 400, description: 'Fechas o datos inválidos' })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  quote(@Body() quoteDto: QuoteBookingDto): Promise<QuoteResponseDto> {
    return this.bookingsService.quote(quoteDto);
  }

  @Post('instant')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear reserva inmediata', description: 'Crea una reserva garantizando idempotencia (idempotencyKey) para evitar cobros y reservas duplicadas.' })
  @ApiResponse({ status: 201, description: 'Reserva creada exitosamente', type: BookingResponseDto })
  @ApiResponse({ status: 400, description: 'Alojamiento no disponible o datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'Conflicto de reserva o clave de idempotencia duplicada' })
  createInstant(@Body() bookingDto: CreateBookingDto): Promise<BookingResponseDto> {
    return this.bookingsService.createInstant(bookingDto);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar estado de reserva', description: 'Retorna el detalle y estado actual de una reserva.' })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Detalle de la reserva', type: BookingResponseDto })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  findOne(@Param('id') id: string): Promise<BookingResponseDto> {
    return this.bookingsService.findOne(id);
  }
}
