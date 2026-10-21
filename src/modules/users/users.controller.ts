import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { UsersService } from './users.service';
import { UserProfileDto } from './dto/user-profile.dto';
import { ChangePasswordDto, ChangePasswordResponseDto, UpdateProfileDto } from './dto/update-profile.dto';

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

  @Patch('me')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar mi nombre y teléfono · HU-007 (CA1, CA3)',
    description:
      'Actualiza el nombre y/o el teléfono del usuario autenticado y registra el evento en la auditoría (RF-010, RN-021). El correo y el rol no se pueden editar.',
  })
  @ApiResponse({ status: 200, description: 'Perfil actualizado (CA1)', type: UserProfileDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos, sin cambios, o intento de editar correo o rol (CA3)' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  updateMyProfile(@Body() dto: UpdateProfileDto, @CurrentUser() user: ActiveSession): UserProfileDto {
    return this.usersService.updateMyProfile(dto, user);
  }

  @Patch('me/password')
  @Roles(Role.HUESPED, Role.ANFITRION, Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar mi contraseña · HU-007 (CA2)',
    description:
      'Verifica la contraseña actual y guarda la nueva si cumple la política. Cierra las demás sesiones de la cuenta y conserva la actual.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada (CA2)', type: ChangePasswordResponseDto })
  @ApiResponse({ status: 400, description: 'Contraseña actual incorrecta, o nueva contraseña que no cumple la política o es igual a la actual' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  changeMyPassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: ActiveSession): ChangePasswordResponseDto {
    return this.usersService.changeMyPassword(dto, user);
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
