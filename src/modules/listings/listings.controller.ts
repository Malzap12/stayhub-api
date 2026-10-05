import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingResponseDto, PaginatedListingsResponseDto } from './dto/listing-response.dto';
import { CheckAvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';

@ApiTags('Alojamientos (Listings)')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publicar un nuevo alojamiento', description: 'Crea un nuevo alojamiento en el marketplace. Requiere rol ANFITRIÓN.' })
  @ApiResponse({ status: 201, description: 'Alojamiento publicado con éxito', type: ListingResponseDto })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  create(@Body() createDto: CreateListingDto): Promise<ListingResponseDto> {
    return this.listingsService.create(createDto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Buscar y filtrar alojamientos', description: 'Búsqueda por ciudad, fechas de estancia, número de huéspedes y rango de precio con paginación.' })
  @ApiResponse({ status: 200, description: 'Listado de alojamientos disponibles', type: PaginatedListingsResponseDto })
  search(@Query() searchDto: SearchListingsDto): Promise<PaginatedListingsResponseDto> {
    return this.listingsService.search(searchDto);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Consultar disponibilidad de un alojamiento', description: 'Retorna si el alojamiento está disponible en el rango de fechas y la lista de días bloqueados.' })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Información de disponibilidad', type: AvailabilityResponseDto })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  getAvailability(
    @Param('id') id: string,
    @Query() query: CheckAvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.listingsService.getAvailability(id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un alojamiento', description: 'Retorna toda la información de un alojamiento específico por su ID.' })
  @ApiParam({ name: 'id', description: 'ID del alojamiento' })
  @ApiResponse({ status: 200, description: 'Detalle del alojamiento', type: ListingResponseDto })
  @ApiResponse({ status: 404, description: 'Alojamiento no encontrado' })
  findOne(@Param('id') id: string): Promise<ListingResponseDto> {
    return this.listingsService.findOne(id);
  }
}
