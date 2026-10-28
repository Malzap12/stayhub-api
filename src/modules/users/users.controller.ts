import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import type { ActiveSession } from '../auth/auth.service';
import { UsersService } from './users.service';
import { UserProfileDto } from './dto/user-profile.dto';
import { ChangePasswordDto, ChangePasswordResponseDto, UpdateProfileDto } from './dto/update-profile.dto';
import { RestrictUserDto, RestrictUserResponseDto, UnrestrictUserResponseDto } from './dto/restrict-user.dto';

@ApiTags('Usuarios (Users)')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar todos los usuarios · HU-053 (CA1, CA2, CA3)',
    description: 'Permite al administrador consultar todos los usuarios registrados para moderación y restricción.',
  })
  @ApiResponse({ status: 200, description: 'Lista de usuarios registrados', type: [UserProfileDto] })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado (requiere rol ADMINISTRADOR)' })
  getAllUsers(): (UserProfileDto & { restrictionReason?: string })[] {
    return this.usersService.getAllUsers();
  }

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

  @Patch(':id/restrict')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restringir a un usuario · HU-053 (CA1, CA2)',
    description:
      'Invalida las sesiones vigentes del usuario y bloquea su inicio de sesión (CA1). Si es anfitrión, sus publicaciones ACTIVAS pasan a PAUSADA y sus reservas futuras a EN_REVISION (CA2).',
  })
  @ApiParam({ name: 'id', description: 'ID o correo del usuario a restringir' })
  @ApiResponse({ status: 200, description: 'Usuario restringido con éxito', type: RestrictUserResponseDto })
  @ApiResponse({ status: 400, description: 'Motivo inválido o usuario ya restringido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado o intento de restringir a un administrador' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  restrictUser(
    @Param('id') id: string,
    @Body() dto: RestrictUserDto,
    @CurrentUser() admin?: ActiveSession,
  ): RestrictUserResponseDto {
    return this.usersService.restrictUser(id, dto, admin?.email);
  }

  @Post(':id/restrict')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restringir a un usuario (alias POST) · HU-053 (CA1, CA2)' })
  restrictUserPost(
    @Param('id') id: string,
    @Body() dto: RestrictUserDto,
    @CurrentUser() admin?: ActiveSession,
  ): RestrictUserResponseDto {
    return this.usersService.restrictUser(id, dto, admin?.email);
  }

  @Patch(':id/unrestrict')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Levantar restricción a un usuario · HU-053 (CA3)',
    description:
      'Permite al usuario volver a iniciar sesión. Sus publicaciones continúan PAUSADAS hasta que el anfitrión las reactive (RF-071, RN-021).',
  })
  @ApiParam({ name: 'id', description: 'ID o correo del usuario' })
  @ApiResponse({ status: 200, description: 'Restricción levantada con éxito', type: UnrestrictUserResponseDto })
  @ApiResponse({ status: 400, description: 'El usuario no está restringido' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Acceso denegado' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  unrestrictUser(
    @Param('id') id: string,
    @CurrentUser() admin?: ActiveSession,
  ): UnrestrictUserResponseDto {
    return this.usersService.unrestrictUser(id, admin?.email);
  }

  @Post(':id/unrestrict')
  @Roles(Role.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Levantar restricción a un usuario (alias POST) · HU-053 (CA3)' })
  unrestrictUserPost(
    @Param('id') id: string,
    @CurrentUser() admin?: ActiveSession,
  ): UnrestrictUserResponseDto {
    return this.usersService.unrestrictUser(id, admin?.email);
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
