import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ListingsService } from './listings.service';

@ApiTags('Alojamientos')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Buscar alojamientos por ciudad, fechas, capacidad y precio' })
  findAll(@Query() query: any) {
    return this.listingsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un alojamiento' })
  findOne(@Param('id') id: string) {
    return this.listingsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear publicación de alojamiento (Solo Anfitrión)' })
  create(@Body() createDto: any) {
    return this.listingsService.create(createDto);
  }
}
