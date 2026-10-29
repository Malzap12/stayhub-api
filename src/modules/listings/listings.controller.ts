import { Controller, Get, Post, Patch, Delete, Body, Query, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { AdditionalServiceDto, ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CreateAdditionalServiceDto, UpdateAdditionalServiceDto } from './dto/additional-service.dto';
import {
  CheckAvailabilityQueryDto,
  AvailabilityResponseDto,
  CreateAvailabilityPeriodDto,
  AvailabilityPeriodResponseDto,
  AvailabilityOverlapErrorDto,
  BlockReservedPeriodDto,
  BlockedPeriodResponseDto,
} from './dto/availability.dto';
import { BlockListingDto, HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
import { MyListingDto } from './dto/my-listing.dto';
import { CancellationPolicyDto, ListingDetailDto, UpdateCancellationPolicyDto } from './dto/listing-detail.dto';
import { ListingCalendarDto } from './dto/calendar.dto';
import { ListingPricingResponseDto, UpdateListingPricingDto } from './dto/listing-pricing.dto';
import { ActivationMissingFieldsErrorDto } from './dto/request-activation.dto';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Alojamientos (Listings)')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('cancellation-policies')
  @Public()
  @ApiOperation({
    summary: 'Consultar el catálogo de políticas de cancelación · HU-039 (CA1)',
    description:
      'Retorna el catálogo de políticas de cancelación disponibles para asociar a una publicación. Incluye la política Flexible: 100 % de devolución hasta 48 h antes de la llegada y 50 % después (RF-058, RN-016).',
  })
  @ApiResponse({ status: 200, description: 'Catálogo de políticas de cancelación (CA1)', type: [CancellationPolicyDto] })
  getCancellationPolicies(): CancellationPolicyDto[] {
    return this.listingsService.getCancellationPolicies();
  }

  @Post()
  // RN-001/RN-002: solo un ANFITRIÓN crea publicaciones y queda como su dueño; el ADMINISTRADOR modera (RN-003) pero nunca es dueño.
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear una publicación en borrador · HU-010 (CA1, CA2, CA3, CA4)',
    description:
      'Crea la publicación en estado BORRADOR asociada al anfitrión autenticado. Solo el título es obligatorio; si falta información básica queda marcada como incompleta (isComplete = false, missingFields). Requiere rol ANFITRION: el ADMINISTRADOR y el HUÉSPED reciben 403 (RN-001, RN-002).',
  })
  @ApiResponse({ status: 201, description: 'Publicación creada en BORRADOR (CA1, CA4)', type: ListingResponseDto })
  @ApiResponse({ status: 400, description: 'Capacidad o precio por noche inválidos; el detalle por campo va en fieldErrors (CA2)' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado para rol HUESPED (CA3)' })
  create(
    @Body() createDto: CreateListingDto,
    @CurrentUser() user?: ActiveSession,
  ): ListingResponseDto {
    return this.listingsService.create(createDto, user);
  }

  @Get('mine')
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar mis publicaciones · HU-010, HU-012',
    description:
      'Retorna solo las publicaciones del anfitrión autenticado, incluidos los borradores, de la más reciente a la más antigua, con título, ciudad, precio y estado (CA1). Si una publicación fue devuelta o bloqueada incluye el motivo indicado por el administrador (CA2). RF-016, RN-005.',
  })
  @ApiResponse({ status: 200, description: 'Publicaciones del anfitrión (CA1, CA2)', type: [MyListingDto] })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado para rol HUESPED' })
  findMine(@CurrentUser() user?: ActiveSession): MyListingDto[] {
    return this.listingsService.findMine(user?.userId ?? '');
  }

  @Get('pending')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cola de revisión de publicaciones pendientes · HU-050 (CA1)',
    description:
      'Retorna las publicaciones en estado PENDIENTE_REVISION ordenadas por fecha de solicitud (más antiguas primero). Exclusivo para ADMINISTRADOR.',
  })
  @ApiResponse({ status: 200, description: 'Cola de publicaciones pendientes ordenada por fecha de solicitud', type: [ListingResponseDto] })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ADMINISTRADOR)' })
  findPendingQueue(): Promise<ListingResponseDto[]> {
    return this.listingsService.findPendingReviewQueue();
  }

  @Get('admin/all')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar todas las publicaciones · HU-051',
    description: 'Retorna las publicaciones en cualquier estado, de la más reciente a la más antigua, para que el administrador pueda bloquearlas. Exclusivo para ADMINISTRADOR.',
  })
  @ApiResponse({ status: 200, description: 'Todas las publicaciones', type: [ListingResponseDto] })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ADMINISTRADOR)' })
  findAllForAdmin(): ListingResponseDto[] {
    return this.listingsService.findAllForAdmin();
  }

  @Patch(':id/block')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bloquear una publicación engañosa · HU-051 (CA1, CA2, CA3)',
    description:
      'Desde cualquier estado pasa la publicación a BLOQUEADA con el motivo indicado y deja de aparecer en las búsquedas (CA1). Sus reservas futuras pasan a EN_REVISION y se conservan (CA2). Se notifica al anfitrión y a los huéspedes afectados, y la acción queda en la auditoría (CA3). RF-067, RF-068, RN-019, RN-020, RN-021.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación' })
  @ApiResponse({ status: 200, description: 'Publicación BLOQUEADA; incluye las reservas que pasaron a EN_REVISION', type: ListingModerationResponseDto })
  @ApiResponse({ status: 400, description: 'Falta el motivo o la publicación ya está BLOQUEADA' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ADMINISTRADOR)' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada' })
  blockListing(
    @Param('id') id: string,
    @Body() dto: BlockListingDto,
    @CurrentUser() user?: ActiveSession,
  ): ListingModerationResponseDto {
    return this.listingsService.blockListing(id, dto, user?.email);
  }

  @Patch(':id/request-activation')
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Solicitar la activación de mi publicación · HU-013 (CA1, CA2, CA3), HU-051 (CA4)',
    description:
      'Envía a revisión una publicación propia en BORRADOR, o en BLOQUEADA ya corregida (HU-051 CA4). Si tiene los 9 campos mínimos (descripción, ciudad, departamento, dirección, tipo, capacidad, precio por noche, servicios y reglas) y al menos una imagen, pasa a PENDIENTE_REVISION (CA1); si no, se rechaza con la lista de campos faltantes (CA2). El cambio queda en la auditoría (CA3). RF-017, RN-005, RN-007, RN-021.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiResponse({ status: 200, description: 'Publicación enviada a revisión: estado PENDIENTE_REVISION (CA1, CA3)', type: MyListingDto })
  @ApiResponse({ status: 400, description: 'Faltan campos mínimos (CA2) o la publicación no está en BORRADOR', type: ActivationMissingFieldsErrorDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado para rol HUESPED' })
  @ApiResponse({ status: 404, description: 'La publicación no existe o pertenece a otro anfitrión (RN-005)' })
  requestActivation(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): MyListingDto {
    return this.listingsService.requestActivation(id, user);
  }

  @Patch(':id/reactivate')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reactivar publicación pausada · HU-053 (CA3)',
    description: 'Permite al anfitrión reactivar una publicación que estaba en PAUSADA para que vuelva a estar ACTIVA.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación' })
  @ApiResponse({ status: 200, description: 'Publicación reactivada a ACTIVA', type: MyListingDto })
  @ApiResponse({ status: 400, description: 'La publicación no está PAUSADA' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ANFITRION)' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada o de otro anfitrión' })
  reactivateListing(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): MyListingDto {
    return this.listingsService.reactivateListing(id, user);
  }

  @Patch(':id/approve')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Aprobar una publicación pendiente · HU-050 (CA2)',
    description:
      'Cambia el estado de la publicación de PENDIENTE_REVISION a ACTIVA, la habilita en las búsquedas públicas y genera notificación para el anfitrión.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación pendiente' })
  @ApiResponse({ status: 200, description: 'Publicación aprobada y activada', type: ListingModerationResponseDto })
  @ApiResponse({ status: 400, description: 'La publicación no está en estado PENDIENTE_REVISION' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada' })
  approveListing(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): Promise<ListingModerationResponseDto> {
    return this.listingsService.approveListing(id, user?.email);
  }

  @Patch(':id/return')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Devolver una publicación pendiente con motivo · HU-050 (CA3)',
    description:
      'Cambia el estado de la publicación de PENDIENTE_REVISION a BORRADOR, registra el motivo de devolución y notifica al anfitrión.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación pendiente' })
  @ApiResponse({ status: 200, description: 'Publicación devuelta a BORRADOR con motivo', type: ListingModerationResponseDto })
  @ApiResponse({ status: 400, description: 'Falta motivo o la publicación no está pendiente' })
  @ApiResponse({ status: 404, description: 'Publicación no encontrada' })
  returnListing(
    @Param('id') id: string,
    @Body() dto: ReturnListingDto,
    @CurrentUser() user?: ActiveSession,
  ): Promise<ListingModerationResponseDto> {
    return this.listingsService.returnListing(id, dto, user?.email);
  }

  @Get('notifications/host')
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar notificaciones de moderación del anfitrión · HU-050 (CA2, CA3)',
    description: 'Permite al anfitrión ver las notificaciones de aprobación o el motivo de devolución de sus publicaciones.',
  })
  @ApiResponse({ status: 200, description: 'Listado de notificaciones del anfitrión', type: [HostNotificationDto] })
  getHostNotifications(@Query('hostId') hostId?: string): Promise<HostNotificationDto[]> {
    return this.listingsService.getHostNotifications(hostId);
  }

  @Patch(':id/cancellation-policy')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Asociar una política de cancelación del catálogo a mi publicación · HU-039 (CA1)',
    description:
      'Permite al anfitrión asociar una política del catálogo (ej. Flexible) a su publicación (RF-058, RN-016).',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiResponse({ status: 200, description: 'Política de cancelación asociada', type: CancellationPolicyDto })
  @ApiResponse({ status: 400, description: 'Política de cancelación inválida' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ANFITRION)' })
  @ApiResponse({ status: 404, description: 'La publicación no existe o pertenece a otro anfitrión (RN-005)' })
  updateCancellationPolicy(
    @Param('id') id: string,
    @Body() dto: UpdateCancellationPolicyDto,
    @CurrentUser() user?: ActiveSession,
  ): CancellationPolicyDto {
    return this.listingsService.updateCancellationPolicy(id, dto, user);
  }

  @Get(':id/pricing')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar tarifa de limpieza y descuento por estancia larga · HU-015',
    description: 'Retorna la tarifa de limpieza fija (COP) y el descuento por estancia larga de una publicación propia (RN-005).',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiResponse({ status: 200, description: 'Tarifas de la publicación', type: ListingPricingResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ANFITRION)' })
  @ApiResponse({ status: 404, description: 'La publicación no existe o pertenece a otro anfitrión (RN-005)' })
  getPricing(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): ListingPricingResponseDto {
    return this.listingsService.getPricing(id, user);
  }

  @Patch(':id/pricing')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Definir limpieza y descuento por estancia larga · HU-015 (CA1, CA2, CA3)',
    description:
      'Define la tarifa de limpieza fija (>= 0 COP, CA1) y un descuento entre 0 % y 50 % a partir de un número mínimo de noches (CA2). Valores fuera de rango se rechazan (CA3). Aplica a las cotizaciones nuevas. RF-019, RN-004, RN-013.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiResponse({ status: 200, description: 'Tarifas guardadas (CA1, CA2)', type: ListingPricingResponseDto })
  @ApiResponse({ status: 400, description: 'Tarifa de limpieza negativa, descuento fuera de 0-50 % o noches mínimas inválidas (CA3)' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ANFITRION)' })
  @ApiResponse({ status: 404, description: 'La publicación no existe o pertenece a otro anfitrión (RN-005)' })
  updatePricing(
    @Param('id') id: string,
    @Body() dto: UpdateListingPricingDto,
    @CurrentUser() user?: ActiveSession,
  ): ListingPricingResponseDto {
    return this.listingsService.updatePricing(id, dto, user);
  }

  @Get(':id/additional-services')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar los servicios adicionales de una publicación propia · HU-016',
    description: 'Servicios adicionales opcionales con su identificador, nombre y costo por estancia (COP).',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiResponse({ status: 200, description: 'Servicios adicionales', type: [AdditionalServiceDto] })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ANFITRION)' })
  @ApiResponse({ status: 404, description: 'La publicación no existe o pertenece a otro anfitrión (RN-005)' })
  getAdditionalServices(@Param('id') id: string, @CurrentUser() user?: ActiveSession): AdditionalServiceDto[] {
    return this.listingsService.getAdditionalServices(id, user);
  }

  @Post(':id/additional-services')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Agregar un servicio adicional con costo · HU-016 (CA1)',
    description:
      'Agrega un servicio opcional con nombre y costo por estancia mayor que 0 COP. Aparece en el detalle de la publicación y se puede ' +
      'seleccionar al cotizar. Máximo 10 por publicación y sin nombres repetidos. RF-020, RN-004, RN-013.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiResponse({ status: 201, description: 'Servicios de la publicación, con el nuevo', type: [AdditionalServiceDto] })
  @ApiResponse({ status: 400, description: 'Nombre vacío o repetido, costo menor o igual a 0 o más de 10 servicios' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ANFITRION)' })
  @ApiResponse({ status: 404, description: 'La publicación no existe o pertenece a otro anfitrión (RN-005)' })
  addAdditionalService(
    @Param('id') id: string,
    @Body() dto: CreateAdditionalServiceDto,
    @CurrentUser() user?: ActiveSession,
  ): AdditionalServiceDto[] {
    return this.listingsService.addAdditionalService(id, dto, user);
  }

  @Patch(':id/additional-services/:serviceId')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Modificar un servicio adicional · HU-016 (CA2)',
    description: 'Cambia el nombre o el costo. Aplica a las cotizaciones nuevas; las reservas ya creadas conservan lo que se cotizó.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiParam({ name: 'serviceId', description: 'ID del servicio adicional' })
  @ApiResponse({ status: 200, description: 'Servicios de la publicación, con el cambio', type: [AdditionalServiceDto] })
  @ApiResponse({ status: 400, description: 'Sin cambios, nombre repetido o costo menor o igual a 0' })
  @ApiResponse({ status: 404, description: 'La publicación o el servicio no existen' })
  updateAdditionalService(
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateAdditionalServiceDto,
    @CurrentUser() user?: ActiveSession,
  ): AdditionalServiceDto[] {
    return this.listingsService.updateAdditionalService(id, serviceId, dto, user);
  }

  @Delete(':id/additional-services/:serviceId')
  @Roles(Role.ANFITRION)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Eliminar un servicio adicional · HU-016 (CA2)',
    description: 'Deja de ofrecerse en las cotizaciones nuevas; las reservas ya creadas conservan el servicio y su costo.',
  })
  @ApiParam({ name: 'id', description: 'ID de la publicación del anfitrión' })
  @ApiParam({ name: 'serviceId', description: 'ID del servicio adicional' })
  @ApiResponse({ status: 200, description: 'Servicios que quedan en la publicación', type: [AdditionalServiceDto] })
  @ApiResponse({ status: 404, description: 'La publicación o el servicio no existen' })
  removeAdditionalService(
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @CurrentUser() user?: ActiveSession,
  ): AdditionalServiceDto[] {
    return this.listingsService.removeAdditionalService(id, serviceId, user);
  }

  @Post(':id/availability-periods')
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Registrar un periodo disponible para reservas · HU-019 (CA1, CA2, CA3)',
    description:
      'Registra un rango de fechas disponible en el alojamiento. Rechaza rangos inválidos, en el pasado o superpuestos con periodos existentes.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 201, description: 'Periodo disponible registrado con éxito (CA1)', type: AvailabilityPeriodResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Fechas inválidas o en el pasado (CA2), o superpuestas con un periodo existente: en ese caso conflictingPeriod indica cuál (CA3)',
    type: AvailabilityOverlapErrorDto,
  })
  @ApiResponse({ status: 404, description: 'El alojamiento no existe o pertenece a otro anfitrión' })
  registerAvailabilityPeriod(
    @Param('id') id: string,
    @Body() dto: CreateAvailabilityPeriodDto,
    @CurrentUser() user?: ActiveSession,
  ): Promise<AvailabilityPeriodResponseDto> {
    return this.listingsService.registerAvailabilityPeriod(id, dto, user);
  }

  @Get(':id/availability-periods')
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar periodos disponibles registrados de un alojamiento · HU-019',
    description: 'Retorna todos los periodos de disponibilidad registrados para el alojamiento ordenados por fecha de inicio.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Lista de periodos disponibles', type: [AvailabilityPeriodResponseDto] })
  @ApiResponse({ status: 404, description: 'El alojamiento no existe o pertenece a otro anfitrión' })
  getAvailabilityPeriods(
    @Param('id') id: string,
    @CurrentUser() user?: ActiveSession,
  ): AvailabilityPeriodResponseDto[] {
    return this.listingsService.getAvailabilityPeriods(id, user);
  }

  @Post(':id/reserved-periods')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bloquear automáticamente el periodo reservado al confirmar · HU-023 (CA1, CA2, CA3)',
    description:
      'Registra el bloqueo automático de las noches en el intervalo [llegada, salida) (AMB-09) tras confirmar una reserva (RF-029, RF-030, RN-011, RN-028). El día de salida queda libre como llegada de otra reserva.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 201, description: 'Noches del periodo reservado bloqueadas con éxito (CA1)', type: BlockedPeriodResponseDto })
  @ApiResponse({ status: 400, description: 'Rango inválido, fuera de disponibilidad o con noches ya reservadas/bloqueadas (CA3)' })
  blockReservedPeriod(
    @Param('id') id: string,
    @Body() dto: BlockReservedPeriodDto,
    @CurrentUser() user?: ActiveSession,
  ): BlockedPeriodResponseDto {
    const guestId = user?.role === Role.HUESPED ? user.userId : undefined;
    // HU-022 CA2: el anfitrión (o el admin) puede registrar un bloqueo de fechas; un huésped solo reservas.
    const type = dto?.type === 'BLOQUEO' && !guestId ? 'BLOQUEO' : 'RESERVA';
    return this.listingsService.blockReservedPeriod(id, dto, user?.email, guestId, type);
  }

  @Get(':id/reserved-periods')
  @Public()
  @ApiOperation({
    summary: 'Listar periodos reservados o bloqueados de un alojamiento · HU-023',
    description: 'Retorna los bloqueos activos en formato de intervalo [checkIn, checkOut) y sus noches bloqueadas.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Listado de periodos reservados/bloqueados', type: [BlockedPeriodResponseDto] })
  getReservedPeriods(@Param('id') id: string): BlockedPeriodResponseDto[] {
    return this.listingsService.getReservedPeriods(id);
  }

  @Get(':id/calendar')
  @Public()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar el calendario de disponibilidad · HU-022 (CA1, CA2)',
    description:
      'Calendario de los próximos 12 meses (desde el mes actual), noche por noche (RF-028). Público para publicaciones ACTIVAS: cada noche es DISPONIBLE o NO_DISPONIBLE (CA1). Con la sesión del anfitrión dueño o del administrador muestra RESERVADA, BLOQUEADA y SIN_PERIODO (CA2). Las noches anteriores a hoy son PASADA.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Calendario de 12 meses', type: ListingCalendarDto })
  @ApiResponse({ status: 404, description: 'Esta publicación no está disponible' })
  getCalendar(@Param('id') id: string, @Headers('authorization') authHeader?: string): ListingCalendarDto {
    return this.listingsService.getCalendar(id, authHeader);
  }

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Buscar y filtrar alojamientos (Público · HU-024 CA1-CA4, HU-025 CA1-CA3 / HU-003 CA3)',
    description:
      'Búsqueda pública sin iniciar sesión. Devuelve solo publicaciones ACTIVAS (CA2) de la ciudad indicada, sin distinguir tildes ni mayúsculas, con capacidad para los huéspedes y, si se indican fechas, con un periodo disponible que cubra toda la estadía (CA1). Sin fechas no se filtra por disponibilidad (CA4). HU-025: filtra por tipo de alojamiento (propertyType), precio por noche en COP entre minPrice y maxPrice (ambos incluidos) y servicios (amenities): la publicación debe tener todos los indicados. Si nada cumple los filtros responde 200 con data vacía (CA3).',
  })
  @ApiResponse({ status: 200, description: 'Listado de alojamientos disponibles', type: PaginatedListingsResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Falta una de las fechas o la salida no es posterior a la llegada (HU-024 CA3); tipo inválido o precio mínimo mayor que el máximo (HU-025)',
  })
  search(@Query() searchDto: SearchListingsDto): Promise<PaginatedListingsResponseDto> {
    return this.listingsService.search(searchDto);
  }

  @Get(':id/availability')
  @Public()
  @ApiOperation({
    summary: 'Consultar disponibilidad de un alojamiento (Público · HU-003 CA3 / HU-019 CA1 / HU-023 CA1-CA3)',
    description:
      'Evalúa la disponibilidad en el intervalo de noches [startDate, endDate) (AMB-09). Si incluye al menos una noche reservada o bloqueada, retorna isAvailable = false y la lista de blockedDates (CA3). El día de salida de una reserva puede ser la llegada de otra (CA2).',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Información de disponibilidad', type: AvailabilityResponseDto })
  @ApiResponse({ status: 400, description: 'Rango de fechas inválido' })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  getAvailability(
    @Param('id') id: string,
    @Query() query: CheckAvailabilityQueryDto,
  ): AvailabilityResponseDto {
    return this.listingsService.getAvailability(id, query);
  }

  @Get(':id/reviews')
  @Public()
  @ApiOperation({
    summary: 'Consultar reseñas públicas de un alojamiento · HU-003 (CA3) / HU-048 (CA1, CA2)',
    description:
      'Permite a cualquier visitante o huésped ver las reseñas de la más reciente a la más antigua y la calificación promedio con un decimal de una publicación sin iniciar sesión (RF-065, RN-025).',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Listado público de reseñas del alojamiento' })
  getReviews(@Param('id') id: string) {
    return this.listingsService.getReviews(id);
  }

  @Get(':id')
  @Public()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar el detalle de una publicación · HU-026 (CA1, CA2) / HU-003 CA3',
    description:
      'Público para publicaciones ACTIVAS: título, descripción, ubicación textual, tipo, capacidad, precio por noche, servicios, reglas, imágenes, política de cancelación, servicios adicionales y calificación promedio (RF-034). Una publicación que no está ACTIVA solo la ven su anfitrión, el administrador y los huéspedes con reservas en ella; para los demás responde 404 (RN-006).',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Detalle de la publicación (CA1)', type: ListingDetailDto })
  @ApiResponse({ status: 404, description: 'Esta publicación no está disponible (CA2)' })
  findOne(@Param('id') id: string, @Headers('authorization') authHeader?: string): ListingDetailDto {
    return this.listingsService.getListingDetail(id, authHeader);
  }
}
