import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { FavoriteIdsDto, FavoritesPageDto, FavoriteToggleResultDto } from './dto/favorite.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('Favoritos · HU-072')
@ApiBearerAuth()
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Listar alojamientos guardados del huésped paginados del más reciente al más antiguo · HU-072 (CA4, CA5)',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, type: FavoritesPageDto })
  @ApiResponse({ status: 403, description: 'Solo los huéspedes pueden consultar favoritos' })
  listMine(
    @CurrentUser() user: ActiveSession,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): FavoritesPageDto {
    return this.favoritesService.listMyFavorites(user, {
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  @Get('ids')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Listar IDs de alojamientos guardados por el huésped · HU-072 (CA1)',
  })
  @ApiResponse({ status: 200, type: FavoriteIdsDto })
  listIds(@CurrentUser() user: ActiveSession): FavoriteIdsDto {
    return this.favoritesService.getMyFavoriteIds(user);
  }

  @Post(':listingId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Guardar alojamiento ACTIVO en favoritos de forma idempotente · HU-072 (CA1, CA3)',
  })
  @ApiParam({ name: 'listingId', description: 'ID del alojamiento a guardar' })
  @ApiResponse({ status: 200, type: FavoriteToggleResultDto })
  save(
    @Param('listingId') listingId: string,
    @CurrentUser() user: ActiveSession,
  ): FavoriteToggleResultDto {
    return this.favoritesService.saveFavorite(listingId, user);
  }

  @Delete(':listingId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Quitar alojamiento de favoritos del huésped · HU-072 (CA2, CA5)',
  })
  @ApiParam({ name: 'listingId', description: 'ID del alojamiento a quitar' })
  @ApiResponse({ status: 200, type: FavoriteToggleResultDto })
  remove(
    @Param('listingId') listingId: string,
    @CurrentUser() user: ActiveSession,
  ): FavoriteToggleResultDto {
    return this.favoritesService.removeFavorite(listingId, user);
  }
}
