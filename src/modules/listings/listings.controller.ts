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
} from './dto/availability.dto';
import { HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
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
    summary: 'Listar mis publicaciones · HU-010',
    description: 'Retorna las publicaciones del anfitrión autenticado, incluidos los borradores, de la más reciente a la más antigua.',
  })
  @ApiResponse({ status: 200, description: 'Publicaciones del anfitrión', type: [ListingResponseDto] })
  @ApiResponse({ status: 403, description: 'Acceso denegado para rol HUESPED' })
  findMine(@CurrentUser() user?: ActiveSession): ListingResponseDto[] {
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
  @ApiResponse({ status: 400, description: 'Fechas inválidas, en el pasado (CA2) o superpuestas con periodo existente (CA3)' })
  registerAvailabilityPeriod(
    @Param('id') id: string,
    @Body() dto: CreateAvailabilityPeriodDto,
  ): Promise<AvailabilityPeriodResponseDto> {
    return this.listingsService.registerAvailabilityPeriod(id, dto);
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
  getAvailabilityPeriods(@Param('id') id: string): Promise<AvailabilityPeriodResponseDto[]> {
    return this.listingsService.getAvailabilityPeriods(id);
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
    summary: 'Consultar disponibilidad de un alojamiento (Público · HU-003 CA3 / HU-019 CA1)',
    description: 'Retorna si el alojamiento está disponible en el rango de fechas y los periodos registrados.',
  })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Información de disponibilidad', type: AvailabilityResponseDto })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  getAvailability(
    @Param('id') id: string,
    @Query() query: CheckAvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
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
