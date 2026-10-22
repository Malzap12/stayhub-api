import { Controller, Post, Get, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { QuoteBookingDto, QuoteResponseDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Reservas y Cotizaciones (Bookings)')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('quote')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cotizar estancia', description: 'Calcula el desglose completo del costo: noches x tarifa base + tarifa de limpieza + comisión de servicio = total.' })
  @ApiResponse({ status: 200, description: 'Cotización calculada exitosamente', type: QuoteResponseDto })
  @ApiResponse({ status: 400, description: 'Fechas o datos inválidos' })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  quote(@Body() quoteDto: QuoteBookingDto): Promise<QuoteResponseDto> {
    return this.bookingsService.quote(quoteDto);
  }

  @Get('my')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar mis reservas · HU-003 (CA1)',
    description: 'Ruta protegida que exige sesión activa. Si el visitante no ha iniciado sesión, responde 401 Unauthorized.',
  })
  @ApiResponse({ status: 200, description: 'Listado de reservas del usuario autenticado', type: [BookingResponseDto] })
  @ApiResponse({ status: 401, description: 'Debes iniciar sesión para acceder a mis reservas (CA1)' })
  findMyBookings(): Promise<BookingResponseDto[]> {
    return this.bookingsService.findMyBookings();
  }

  @Post('instant')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear reserva inmediata', description: 'Crea una reserva garantizando idempotencia (idempotencyKey) para evitar cobros y reservas duplicadas.' })
  @ApiResponse({ status: 201, description: 'Reserva creada exitosamente', type: BookingResponseDto })
  @ApiResponse({ status: 400, description: 'Alojamiento no disponible o datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autenticado (CA1)' })
  @ApiResponse({ status: 409, description: 'Conflicto de reserva o clave de idempotencia duplicada' })
  createInstant(
    @Body() bookingDto: CreateBookingDto,
    @CurrentUser() user?: ActiveSession,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.createInstant(bookingDto, user?.email);
  }

  @Patch(':id/confirm')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirmar reserva y bloquear automáticamente el periodo reservado · HU-023 (CA1, CA2, CA3)',
    description:
      'Registra la confirmación de la reserva y bloquea automáticamente las noches del intervalo [checkIn, checkOut) (AMB-09) en el alojamiento.',
  })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Reserva confirmada y noches bloqueadas (CA1)', type: BookingResponseDto })
  @ApiResponse({ status: 400, description: 'El rango incluye noches ya reservadas o bloqueadas (CA3)' })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  confirmBooking(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.confirmBooking(id, user?.email);
  }

  @Get(':id')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar estado de reserva', description: 'Retorna el detalle y estado actual de una reserva.' })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Detalle de la reserva', type: BookingResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado (CA1)' })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  findOne(@Param('id') id: string): Promise<BookingResponseDto> {
    return this.bookingsService.findOne(id);
  }
}
