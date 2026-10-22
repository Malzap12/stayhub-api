import { Controller, Get, Post, Patch, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import {
  CheckAvailabilityQueryDto,
  AvailabilityResponseDto,
  CreateAvailabilityPeriodDto,
  AvailabilityPeriodResponseDto,
  AvailabilityOverlapErrorDto,
  BlockReservedPeriodDto,
  BlockedPeriodResponseDto,
} from './dto/availability.dto';
import { HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
import { MyListingDto } from './dto/my-listing.dto';
import { ActivationMissingFieldsErrorDto } from './dto/request-activation.dto';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ActiveSession } from '../auth/auth.service';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Alojamientos (Listings)')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post()
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear una publicación en borrador · HU-010 (CA1, CA2, CA3, CA4)',
    description:
      'Crea la publicación en estado BORRADOR asociada al anfitrión autenticado. Solo el título es obligatorio; si falta información básica queda marcada como incompleta (isComplete = false, missingFields). Requiere rol ANFITRION o ADMINISTRADOR.',
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

  @Patch(':id/request-activation')
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Solicitar la activación de mi publicación · HU-013 (CA1, CA2, CA3)',
    description:
      'Envía a revisión una publicación propia en BORRADOR. Si tiene los 9 campos mínimos (descripción, ciudad, departamento, dirección, tipo, capacidad, precio por noche, servicios y reglas) y al menos una imagen, pasa a PENDIENTE_REVISION (CA1); si no, se rechaza con la lista de campos faltantes (CA2). El cambio queda en la auditoría (CA3). RF-017, RN-005, RN-007, RN-021.',
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
    return this.listingsService.blockReservedPeriod(id, dto, user?.email);
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

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Buscar y filtrar alojamientos (Público · HU-003 CA3 / HU-050 CA2)',
    description: 'Búsqueda pública por ciudad, fechas de estancia, número de huéspedes y rango de precio sin iniciar sesión (solo publicaciones ACTIVAS).',
  })
  @ApiResponse({ status: 200, description: 'Listado de alojamientos disponibles', type: PaginatedListingsResponseDto })
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
    summary: 'Consultar reseñas públicas de un alojamiento · HU-003 (CA3)',
    description: 'Permite a cualquier visitante ver las reseñas y calificación promedio de una publicación sin iniciar sesión.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Listado público de reseñas del alojamiento' })
  getReviews(@Param('id') id: string) {
    return this.listingsService.getReviews(id);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Obtener detalle de un alojamiento (Público · HU-003 CA3)',
    description: 'Retorna toda la información de un alojamiento específico por su ID sin exigir inicio de sesión.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Detalle del alojamiento', type: ListingResponseDto })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  findOne(@Param('id') id: string): Promise<ListingResponseDto> {
    return this.listingsService.findOne(id);
  }
}
