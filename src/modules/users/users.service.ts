import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService, UserAccount } from '../auth/auth.service';
import { UserProfileDto } from './dto/user-profile.dto';

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
    const account = this.authService.findById(session.userId);
    if (!account) {
      throw new NotFoundException('No encontramos tu cuenta');
    }
    return toUserProfile(account);
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
}
