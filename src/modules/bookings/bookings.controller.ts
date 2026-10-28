import { Controller, Post, Get, Patch, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { BookingsService, StayClosureResult } from './bookings.service';
import { QuoteBookingDto, QuoteResponseDto, QuoteValidationErrorDto } from './dto/quote-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { BookingPaymentResultDto, BookingResponseDto } from './dto/booking-response.dto';
import { PaymentCardDto } from '../payments/dto/payment.dto';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';
import { BookingStatus } from '../../common/enums/booking-status.enum';

@ApiTags('Reservas y Cotizaciones (Bookings)')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('quote')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cotizar una estancia · HU-027 (CA1, CA2, CA3, CA4)',
    description:
      'Desglose en COP (RF-036 a RF-038): noches, precio base, descuento por estancia larga, limpieza, cada servicio adicional seleccionado y tarifa de servicio. total = (precio base − descuento) + limpieza + adicionales + tarifa de servicio; la tarifa es el porcentaje configurado (HU-029) sobre esa suma.',
  })
  @ApiResponse({ status: 200, description: 'Cotización calculada', type: QuoteResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'HU-028: salida no posterior a la llegada (FECHAS_INVALIDAS), más huéspedes que la capacidad (CAPACIDAD_EXCEDIDA, con maxGuests) o periodo no disponible (PERIODO_NO_DISPONIBLE, con unavailableNights); también un servicio adicional inexistente o datos inválidos',
    type: QuoteValidationErrorDto,
  })
  @ApiResponse({ status: 404, description: 'La publicación no existe o no tiene precio por noche' })
  quote(@Body() quoteDto: QuoteBookingDto): Promise<QuoteResponseDto> {
    return this.bookingsService.quote(quoteDto);
  }

  @Get('my')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar mis reservas · HU-003 · HU-034 (CA1, CA2)',
    description:
      'Ruta protegida que exige sesión activa (RF-048, RNF-022). Devuelve el historial de reservas del usuario autenticado ordenadas por fecha de llegada, con soporte de filtro por estado y paginación.',
  })
  @ApiQuery({ name: 'status', required: false, enum: BookingStatus, description: 'Filtrar por estado de la reserva (HU-034 CA1)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página para paginación (HU-034 CA2)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Cantidad de elementos por página (HU-034 CA2)' })
  @ApiResponse({ status: 200, description: 'Listado de reservas del usuario autenticado', type: [BookingResponseDto] })
  @ApiResponse({ status: 401, description: 'Debes iniciar sesión para acceder a mis reservas (CA1)' })
  findMyBookings(
    @CurrentUser() user?: ActiveSession,
    @Query('status') status?: BookingStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<BookingResponseDto[]> {
    return this.bookingsService.findMyBookings(user?.email, {
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('instant')
  // RF-041: solo el huésped reserva; el anfitrión gestiona sus fechas con bloqueos (RF-029), no con reservas.
  @Roles(Role.HUESPED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear reserva inmediata · HU-030 · HU-032 (CA1, CA2)',
    description:
      'Crea una reserva garantizando idempotencia (idempotencyKey) para evitar cobros y reservas duplicadas (RF-044, RN-018): reenviar la misma clave por un reintento o un doble clic devuelve la reserva original sin crear otra ni repetir el cobro simulado, aunque la primera solicitud siga en proceso. Una clave nueva crea una reserva nueva.',
  })
  @ApiResponse({ status: 201, description: 'Reserva creada exitosamente', type: BookingResponseDto })
  @ApiResponse({ status: 400, description: 'Alojamiento no disponible o datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autenticado (CA1)' })
  @ApiResponse({ status: 403, description: 'Solo una cuenta de huésped puede reservar (RF-041); anfitriones y administradores reciben 403' })
  @ApiResponse({
    status: 409,
    description:
      'HU-032: la clave ya la usó otro usuario (CLAVE_IDEMPOTENCIA_EN_USO) o se usó para otra estancia (CLAVE_IDEMPOTENCIA_REUTILIZADA)',
  })
  createInstant(
    @Body() bookingDto: CreateBookingDto,
    @CurrentUser() user?: ActiveSession,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.createInstant(bookingDto, user?.email);
  }

  @Post(':id/pay')
  // RF-041: solo el huésped reserva; el anfitrión gestiona sus fechas con bloqueos (RF-029), no con reservas.
  @Roles(Role.HUESPED)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pagar la reserva con una tarjeta de prueba · HU-037 (CA1, CA2, CA3)',
    description:
      'Procesa el pago en el modo de pruebas del proveedor (nunca con claves de producción). Si se aprueba, el pago queda APROBADO con su referencia y la reserva se confirma bloqueando sus noches; si se rechaza, el pago queda RECHAZADO, la reserva sigue PENDIENTE y las fechas no se bloquean. HU-031: antes de cobrar verifica de nuevo la disponibilidad; los pagos y confirmaciones de un mismo alojamiento se procesan de a una, así que con solicitudes simultáneas sobre el mismo periodo como máximo una queda CONFIRMADA. Si el bloqueo falla después de aprobar el pago, el pago queda REVERTIDO.',
  })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Resultado del pago y estado de la reserva', type: BookingPaymentResultDto })
  @ApiResponse({
    status: 400,
    description:
      'Tarjeta que no es de prueba (TARJETA_NO_DE_PRUEBA), reserva no pendiente o periodo que ya no está disponible (HU-031 CA1: PERIODO_NO_DISPONIBLE con unavailableNights; no se hace el cobro)',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  @ApiResponse({ status: 409, description: 'La reserva ya está confirmada y pagada' })
  @ApiResponse({ status: 503, description: 'El proveedor no está en modo de pruebas o hay claves de producción configuradas (CA3)' })
  payBooking(
    @Param('id') id: string,
    @Body() card: PaymentCardDto,
    @CurrentUser() user?: ActiveSession,
  ): Promise<BookingPaymentResultDto> {
    return this.bookingsService.payBooking(id, card, user?.email);
  }

  @Patch(':id/confirm')
  // RF-041: solo el huésped reserva; el anfitrión gestiona sus fechas con bloqueos (RF-029), no con reservas.
  @Roles(Role.HUESPED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirmar reserva y bloquear automáticamente el periodo reservado · HU-023 (CA1, CA2, CA3) · HU-031 (CA1, CA2)',
    description:
      'Verifica de nuevo la disponibilidad (RF-042), registra la confirmación de la reserva y bloquea automáticamente las noches del intervalo [checkIn, checkOut) (AMB-09). Se procesa en el mismo turno que los pagos del alojamiento (RF-043). Confirmar una reserva ya CONFIRMADA la devuelve sin cambios.',
  })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Reserva confirmada y noches bloqueadas (CA1)', type: BookingResponseDto })
  @ApiResponse({
    status: 400,
    description: 'El periodo ya no está disponible (PERIODO_NO_DISPONIBLE, con unavailableNights) o la reserva no está PENDIENTE',
  })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  confirmBooking(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.confirmBooking(id, user?.email);
  }

  @Post('daily-closure')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ejecutar ahora el proceso diario de cierre de estancias · HU-046 (CA1, CA2, CA3)',
    description:
      'El proceso corre solo todos los días a las 00:05 (hora de Colombia) y al arrancar el servidor. Pasa a COMPLETADA cada reserva CONFIRMADA cuya fecha de salida ya pasó, registra el cambio en la auditoría (RN-021) y notifica al huésped invitándolo a reseñar (RF-062). Las reservas CANCELADAS o EN_REVISION no cambian. Este endpoint permite al administrador ejecutarlo sin esperar.',
  })
  @ApiResponse({ status: 201, description: 'Fecha usada, cantidad e IDs de las reservas completadas' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Solo un administrador puede ejecutarlo' })
  runDailyClosure(@CurrentUser() user?: ActiveSession): StayClosureResult {
    return this.bookingsService.completeFinishedStays(new Date(), user?.email);
  }

  @Patch(':id/cancel')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancelar mi reserva · HU-040 (CA1, CA2, CA3)',
    description:
      'El huésped cancela su reserva CONFIRMADA antes de la llegada (15:00 del día de llegada, hora de Colombia) indicando un motivo (RF-053). La reserva pasa a CANCELADA, sus noches vuelven a estar disponibles (RF-055, RN-029) y se registra usuario, fecha y hora, motivo, devolución simulada según la política de la publicación (sobre el total menos la tarifa de servicio) y estado final (RF-056, RN-017), con un evento de auditoría (RN-021).',
  })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Reserva CANCELADA con su registro de cancelación', type: BookingResponseDto })
  @ApiResponse({
    status: 400,
    description: 'La llegada ya pasó (LLEGADA_PASADA, CA2), la reserva no está CONFIRMADA (ESTADO_NO_CANCELABLE) o falta el motivo',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'La reserva es de otro huésped' })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  cancelBooking(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user?: ActiveSession,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.cancelBooking(id, dto, user?.email);
  }

  @Get(':id')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar el estado y el detalle de mi reserva · HU-033 (CA1, CA2)',
    description:
      'Devuelve alojamiento (título, ciudad e imagen), fechas, huéspedes, desglose de la cotización, política de cancelación y estado de la reserva (RF-047). Solo la consulta el huésped que la hizo o un administrador.',
  })
  @ApiParam({ name: 'id', description: 'ID de la reserva' })
  @ApiResponse({ status: 200, description: 'Detalle de la reserva', type: BookingResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'La reserva es de otro huésped (CA2)' })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada' })
  findOne(@Param('id') id: string, @CurrentUser() user?: ActiveSession): Promise<BookingResponseDto> {
    return this.bookingsService.findOne(id, user ? { email: user.email, role: user.role } : undefined);
  }
}
