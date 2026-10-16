import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CheckAvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';
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

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Buscar y filtrar alojamientos (Público · HU-003 CA3)',
    description: 'Búsqueda pública por ciudad, fechas de estancia, número de huéspedes y rango de precio sin iniciar sesión.',
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

