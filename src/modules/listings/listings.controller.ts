import { Controller, Get, Post, Patch, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CheckAvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';
import { HostNotificationDto, ListingModerationResponseDto, ReturnListingDto } from './dto/review-listing.dto';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Alojamientos (Listings)')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post()
  @Roles(Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Publicar un nuevo alojamiento · HU-003 (CA2)',
    description: 'Crea un nuevo alojamiento en el marketplace. Requiere rol ANFITRION o ADMINISTRADOR.',
  })
  @ApiResponse({ status: 201, description: 'Alojamiento publicado con éxito', type: ListingResponseDto })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autenticado (CA1)' })
  @ApiResponse({ status: 403, description: 'Acceso denegado para rol HUESPED (CA2)' })
  create(@Body() createDto: CreateListingDto): Promise<ListingResponseDto> {
    return this.listingsService.create(createDto);
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
  approveListing(@Param('id') id: string): Promise<ListingModerationResponseDto> {
    return this.listingsService.approveListing(id);
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
  ): Promise<ListingModerationResponseDto> {
    return this.listingsService.returnListing(id, dto);
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
    summary: 'Consultar disponibilidad de un alojamiento (Público · HU-003 CA3)',
    description: 'Retorna si el alojamiento está disponible en el rango de fechas y la lista de días bloqueados.',
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
