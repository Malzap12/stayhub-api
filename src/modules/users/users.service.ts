import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService, UserAccount } from '../auth/auth.service';
import { UserProfileDto } from './dto/user-profile.dto';
import { ChangePasswordDto, ChangePasswordResponseDto, UpdateProfileDto } from './dto/update-profile.dto';

export function toUserProfile(account: UserAccount): UserProfileDto {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone ?? null,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  /** HU-006 CA1: datos básicos de la cuenta con sesión activa. */
  getMyProfile(session: ActiveSession): UserProfileDto {
    return toUserProfile(this.findAccount(session));
  }

  /** HU-006 CA2: solo se puede consultar el propio perfil por su identificador. */
  getProfileById(id: string, session: ActiveSession): UserProfileDto {
    if (id !== session.userId) {
      this.auditService.record({
        actor: session.email,
        action: AuditAction.ACCESS_DENIED,
        entity: 'UserAccount',
        entityId: id,
        result: AuditResult.FALLIDO,
        detail: 'Intento de consultar el perfil de otro usuario',
      });
      throw new ForbiddenException('No puedes consultar el perfil de otro usuario');
    }
    return this.getMyProfile(session);
  }

  /** HU-007 CA1: actualiza nombre y/o teléfono y registra el evento (RN-021). */
  updateMyProfile(dto: UpdateProfileDto, session: ActiveSession): UserProfileDto {
    const account = this.findAccount(session);
    const changed: string[] = [];

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== account.name) {
        account.name = name;
        changed.push('nombre');
      }
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone?.trim() || undefined;
      if (phone !== account.phone) {
        account.phone = phone;
        changed.push('teléfono');
      }
    }

    if (changed.length === 0) {
      throw new BadRequestException('No hay cambios para guardar');
    }

    this.auditService.record({
      actor: session.email,
      action: AuditAction.PROFILE_UPDATE,
      entity: 'UserAccount',
      entityId: account.id,
      result: AuditResult.EXITOSO,
      detail: `Campos actualizados: ${changed.join(', ')}`,
    });
    return toUserProfile(account);
  }

  /**
   * HU-007 CA2: cambia la contraseña si la actual es correcta y la nueva cumple la política.
   * Cierra las demás sesiones de la cuenta y conserva la actual.
   */
  changeMyPassword(dto: ChangePasswordDto, session: ActiveSession): ChangePasswordResponseDto {
    const account = this.findAccount(session);

    if (!this.authService.verifyPassword(dto.currentPassword, account.passwordHash)) {
      this.recordPasswordChange(session, account.id, AuditResult.FALLIDO, 'Contraseña actual incorrecta');
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    if (!this.authService.isPasswordCompliant(dto.newPassword)) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres y combinar letras y números');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('La nueva contraseña debe ser diferente de la actual');
    }

    this.authService.updatePassword(account.email, dto.newPassword, session.token);
    this.recordPasswordChange(session, account.id, AuditResult.EXITOSO);
    return { message: 'Contraseña actualizada correctamente' };
  }

  private findAccount(session: ActiveSession): UserAccount {
    const account = this.authService.findById(session.userId);
    if (!account) {
      throw new NotFoundException('No encontramos tu cuenta');
    }
    return account;
  }

  private recordPasswordChange(session: ActiveSession, accountId: string, result: AuditResult, detail?: string): void {
    this.auditService.record({
      actor: session.email,
      action: AuditAction.PASSWORD_CHANGE,
      entity: 'UserAccount',
      entityId: accountId,
      result,
      detail,
    });
  }
}
