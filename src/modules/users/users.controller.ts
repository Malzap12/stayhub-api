import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { UsersService } from './users.service';
import { UserProfileDto } from './dto/user-profile.dto';

@ApiTags('Usuarios (Users)')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar mi perfil · HU-006 (CA1)',
    description: 'Retorna nombre, correo, teléfono, rol y estado de la cuenta del usuario autenticado (RF-009).',
  })
  @ApiResponse({ status: 200, description: 'Perfil del usuario autenticado (CA1)', type: UserProfileDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  getMyProfile(@CurrentUser() user: ActiveSession): UserProfileDto {
    return this.usersService.getMyProfile(user);
  }

  @Get(':id')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar un perfil por identificador · HU-006 (CA2)',
    description: 'Solo permite consultar el propio perfil; el perfil de otro usuario responde 403 y queda en la auditoría.',
  })
  @ApiParam({ name: 'id', description: 'ID del usuario' })
  @ApiResponse({ status: 200, description: 'Perfil propio', type: UserProfileDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No puedes consultar el perfil de otro usuario (CA2)' })
  getProfileById(@Param('id') id: string, @CurrentUser() user: ActiveSession): UserProfileDto {
    return this.usersService.getProfileById(id, user);
  }
}
