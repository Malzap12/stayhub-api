import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { ActiveSession, AuthService, UserAccount } from '../auth/auth.service';
import { ListingsService } from '../listings/listings.service';
import { BookingsService } from '../bookings/bookings.service';
import { UserProfileDto } from './dto/user-profile.dto';
import { ChangePasswordDto, ChangePasswordResponseDto, UpdateProfileDto } from './dto/update-profile.dto';
import { RestrictUserDto, RestrictUserResponseDto, UnrestrictUserResponseDto } from './dto/restrict-user.dto';
import { DeactivateAccountResponseDto, DeactivationCheckDto } from './dto/deactivate-account.dto';

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
    @Optional() private readonly listingsService?: ListingsService,
    @Optional() private readonly bookingsService?: BookingsService,
  ) {}

  /** HU-053: Retorna todos los usuarios registrados para el panel de administración. */
  getAllUsers(): (UserProfileDto & { restrictionReason?: string })[] {
    return this.authService.getAllUsers().map((u) => ({
      ...toUserProfile(u),
      restrictionReason: u.restrictionReason,
    }));
  }

  /**
   * HU-053 CA1 y CA2 (RF-070, RN-020):
   * Restringe a un usuario indicando el motivo:
   * - No puede iniciar sesión y su sesión vigente se invalida (CA1).
   * - Si es anfitrión, sus publicaciones ACTIVAS pasan a PAUSADA y sus reservas futuras a EN_REVISION (CA2).
   */
  restrictUser(
    idOrEmail: string,
    dto: RestrictUserDto,
    actor?: string,
  ): RestrictUserResponseDto {
    const reason = dto?.reason?.trim();
    if (!reason || reason.length < 5) {
      throw new BadRequestException('Indica el motivo de la restricción (al menos 5 caracteres)');
    }

    const account = this.authService.findById(idOrEmail) ?? this.authService.findByEmail(idOrEmail);
    if (!account) {
      throw new NotFoundException(`Usuario con identificador ${idOrEmail} no encontrado`);
    }
    if (account.role === Role.ADMINISTRADOR) {
      throw new ForbiddenException('No está permitido restringir a un usuario con rol ADMINISTRADOR');
    }
    if (account.status === 'RESTRINGIDA') {
      throw new BadRequestException('El usuario ya se encuentra restringido');
    }

    // CA1: Restringe e invalida sesiones vigentes
    this.authService.restrictAccount(account.email, reason, actor);

    // CA2: Si es anfitrión (o tiene publicaciones), publicaciones ACTIVAS a PAUSADA y reservas futuras a EN_REVISION
    const pausedListings: string[] = [];
    const bookingsUnderReview: string[] = [];

    if (this.listingsService) {
      const activePaused = this.listingsService.pauseHostActiveListings(account.id, actor);
      const activePausedByEmail = this.listingsService.pauseHostActiveListings(account.email, actor);
      const allPaused = [...activePaused, ...activePausedByEmail];
      const uniquePausedIds = Array.from(new Set(allPaused.map((l) => l.id)));
      pausedListings.push(...uniquePausedIds);

      const allListings = this.listingsService.findAllForAdmin();
      const hostListingIds = allListings
        .filter((l) => l.hostId === account.id || l.hostId === account.email)
        .map((l) => l.id);

      if (this.bookingsService && hostListingIds.length > 0) {
        const affectedBookings = this.bookingsService.putHostFutureBookingsUnderReview(
          hostListingIds,
          `Anfitrión restringido: ${reason}`,
          actor,
        );
        bookingsUnderReview.push(...affectedBookings);
      }
    }

    return {
      userId: account.id,
      email: account.email,
      status: 'RESTRINGIDA',
      restrictionReason: reason,
      pausedListings,
      bookingsUnderReview,
      message: `Usuario ${account.name} restringido exitosamente.`,
    };
  }

  /**
   * HU-053 CA3 (RF-071, RN-021):
   * Levanta la restricción a un usuario:
   * - Puede iniciar sesión de nuevo.
   * - Sus publicaciones siguen PAUSADAS hasta que las reactive.
   */
  unrestrictUser(idOrEmail: string, actor?: string): UnrestrictUserResponseDto {
    const account = this.authService.findById(idOrEmail) ?? this.authService.findByEmail(idOrEmail);
    if (!account) {
      throw new NotFoundException(`Usuario con identificador ${idOrEmail} no encontrado`);
    }
    if (account.status !== 'RESTRINGIDA') {
      throw new BadRequestException('El usuario no se encuentra restringido');
    }

    this.authService.unrestrictAccount(account.id, actor);

    return {
      userId: account.id,
      email: account.email,
      status: 'ACTIVA',
      message: `Restricción levantada exitosamente para ${account.name}. Sus publicaciones continúan PAUSADAS hasta que las reactive.`,
    };
  }

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

  /**
   * HU-008 · Revisión previa a la desactivación (CA2, CA3): reservas futuras confirmadas que la impiden y
   * publicaciones activas que pasarían a PAUSADA.
   */
  getDeactivationCheck(session: ActiveSession, now = new Date()): DeactivationCheckDto {
    const account = this.findAccount(session);
    const upcomingBookings = this.bookingsService?.findUpcomingConfirmed({ email: account.email, userId: account.id }, now) ?? [];
    const listingsToPause =
      account.role === Role.ANFITRION
        ? (this.listingsService?.findHostActiveListings(account.id) ?? []).map((listing) => ({ id: listing.id, title: listing.title }))
        : [];
    return { canDeactivate: upcomingBookings.length === 0, upcomingBookings, listingsToPause };
  }

  /**
   * HU-008 · Desactivar mi cuenta (CA1, CA2, CA3 · RF-011, RN-021).
   * CA2: con reservas futuras confirmadas (como huésped o en sus alojamientos) se rechaza con 409 y la lista.
   * CA3: las publicaciones ACTIVAS del anfitrión pasan a PAUSADA.
   * CA1: la cuenta pasa a DESACTIVADA, se cierran sus sesiones y se registra el evento. El historial se conserva.
   */
  deactivateMyAccount(session: ActiveSession, now = new Date()): DeactivateAccountResponseDto {
    const account = this.findAccount(session);
    const check = this.getDeactivationCheck(session, now);
    if (!check.canDeactivate) {
      const count = check.upcomingBookings.length;
      this.recordDeactivation(session, account.id, AuditResult.FALLIDO, `Desactivación rechazada: ${count} reserva(s) futura(s) confirmada(s)`);
      throw new ConflictException({
        statusCode: 409,
        code: 'RESERVAS_FUTURAS_CONFIRMADAS',
        message: `No puedes desactivar tu cuenta: tienes ${count} ${count === 1 ? 'reserva futura confirmada' : 'reservas futuras confirmadas'}.`,
        upcomingBookings: check.upcomingBookings,
      });
    }

    const paused =
      account.role === Role.ANFITRION
        ? (this.listingsService?.pauseHostActiveListings(account.id, account.email, 'desactivación de la cuenta del anfitrión') ?? [])
        : [];
    this.authService.deactivateAccount(account, now);
    this.recordDeactivation(
      session,
      account.id,
      AuditResult.EXITOSO,
      `Cuenta desactivada por el usuario${paused.length ? `; publicaciones pausadas: ${paused.length}` : ''}`,
    );
    return {
      message: 'Tu cuenta quedó desactivada y tu sesión se cerró. Tu historial se conserva.',
      status: 'DESACTIVADA',
      pausedListings: paused.map((listing) => ({ id: listing.id, title: listing.title })),
    };
  }

  private recordDeactivation(session: ActiveSession, accountId: string, result: AuditResult, detail: string): void {
    this.auditService.record({
      actor: session.email,
      action: AuditAction.ACCOUNT_DEACTIVATION,
      entity: 'UserAccount',
      entityId: accountId,
      result,
      detail,
    });
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
