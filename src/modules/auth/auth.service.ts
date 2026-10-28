import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  Optional,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Role } from '../../common/enums/role.enum';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { AuditEvent, AuditService } from '../audit/audit.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  LoginDto,
  LoginResponseDto,
  LogoutResponseDto,
  RegisterDto,
  RegisteredUserDto,
} from './dto/auth.dto';

export type AccountStatus = 'ACTIVA' | 'DESACTIVADA' | 'RESTRINGIDA';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: Role;
  status: AccountStatus;
  restrictionReason?: string;
  createdAt: Date;
}

export interface ActiveSession {
  token: string;
  userId: string;
  email: string;
  role: Role;
  expiresAt: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly users: Map<string, UserAccount> = new Map();
  private readonly activeSessions: Map<string, ActiveSession> = new Map();
  private static readonly PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  private static readonly GENERIC_LOGIN_ERROR =
    'Correo electrónico o contraseña incorrectos';

  constructor(
    private readonly auditService: AuditService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly persistence?: StatePersistenceService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.persistence?.register('auth', {
      dump: () => ({ users: [...this.users.entries()], sessions: [...this.activeSessions.entries()] }),
      restore: (data) => {
        this.users.clear();
        this.activeSessions.clear();
        const state = data as { users: Array<[string, UserAccount]>; sessions: Array<[string, ActiveSession]> };
        state?.users?.forEach(([email, account]) => this.users.set(email, account));
        state?.sessions?.forEach(([token, session]) => this.activeSessions.set(token, session));
        this.seedInitialAdmin();
      },
    });
    this.seedInitialAdmin();
  }

  private recordAudit(
    actor: string | undefined,
    action: AuditAction,
    result: AuditResult,
    detail?: string,
  ): void {
    this.auditService.record({ actor, action, entity: 'AuthSession', result, detail });
  }

  getAuditEvents(): AuditEvent[] {
    return this.auditService.findAll();
  }

  hashPassword(plainPassword: string): string {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(plainPassword, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  verifyPassword(plainPassword: string, storedHash: string): boolean {
    const [salt, keyHex] = storedHash.split(':');
    if (!salt || !keyHex) {
      return false;
    }
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedBuffer = scryptSync(plainPassword, salt, 64);
    return (
      keyBuffer.length === derivedBuffer.length &&
      timingSafeEqual(keyBuffer, derivedBuffer)
    );
  }

  seedInitialAdmin(): UserAccount {
    const adminEmail = (
      this.configService?.get<string>('ADMIN_INITIAL_EMAIL') ??
      process.env.ADMIN_INITIAL_EMAIL ??
      'admin@inversioneslr.com'
    )
      .trim()
      .toLowerCase();
    const adminPassword =
      this.configService?.get<string>('ADMIN_INITIAL_PASSWORD') ??
      process.env.ADMIN_INITIAL_PASSWORD ??
      'AdminLr2026!';
    const adminName =
      this.configService?.get<string>('ADMIN_INITIAL_NAME') ??
      process.env.ADMIN_INITIAL_NAME ??
      'Administrador Inversiones LR';

    const existingAdmin = Array.from(this.users.values()).find(
      (user) => user.role === Role.ADMINISTRADOR,
    );

    if (existingAdmin) {
      return existingAdmin;
    }

    const initialAdmin: UserAccount = {
      id: 'initial-admin-uuid',
      name: adminName,
      email: adminEmail,
      passwordHash: this.hashPassword(adminPassword),
      role: Role.ADMINISTRADOR,
      status: 'ACTIVA',
      createdAt: new Date(),
    };

    this.users.set(adminEmail, initialAdmin);
    return initialAdmin;
  }

  /** HU-056 · Todas las cuentas registradas, para los indicadores del administrador. */
  listAccounts(): UserAccount[] {
    return [...this.users.values()];
  }

  getAdmins(): UserAccount[] {
    return Array.from(this.users.values()).filter(
      (user) => user.role === Role.ADMINISTRADOR,
    );
  }

  isPasswordCompliant(plainPassword?: string): boolean {
    return Boolean(plainPassword) && AuthService.PASSWORD_REGEX.test(plainPassword as string);
  }

  /**
   * HU-004 CA2: actualiza la contraseña con hash e invalida las sesiones
   * activas de la cuenta para obligar a ingresar con la nueva clave.
   * HU-007 CA2: `keepToken` conserva la sesión desde la que el usuario hizo el cambio.
   */
  updatePassword(email: string, newPassword: string, keepToken?: string): void {
    const account = this.findByEmail(email);
    if (!account) {
      return;
    }
    account.passwordHash = this.hashPassword(newPassword);
    for (const [token, session] of this.activeSessions) {
      if (session.userId === account.id && token !== keepToken) {
        this.activeSessions.delete(token);
      }
    }
  }

  findByEmail(email: string): UserAccount | undefined {
    return this.users.get(email.trim().toLowerCase());
  }

  findById(id: string): UserAccount | undefined {
    return Array.from(this.users.values()).find((user) => user.id === id);
  }

  restrictAccount(
    email: string,
    reason = 'Incumplimiento de políticas',
    actor?: string,
  ): void {
    const account = this.findByEmail(email);
    if (account) {
      account.status = 'RESTRINGIDA';
      account.restrictionReason = reason;

      // HU-053 CA1: la sesión vigente se invalida inmediatamente
      for (const [token, session] of this.activeSessions.entries()) {
        if (session.userId === account.id || session.email.toLowerCase() === account.email.toLowerCase()) {
          this.activeSessions.delete(token);
        }
      }
      this.auditService.record({
        actor,
        action: AuditAction.ADMIN_ACTION,
        entity: 'UserAccount',
        entityId: account.id,
        result: AuditResult.EXITOSO,
        detail: `Cuenta restringida: ${reason}`,
      });
      this.notificationsService?.accountRestricted(account, reason);
    }
  }

  /** HU-053 CA3: levanta la restricción de una cuenta para que pueda volver a iniciar sesión. */
  unrestrictAccount(emailOrId: string, actor?: string): UserAccount {
    const account = this.findByEmail(emailOrId) ?? this.findById(emailOrId);
    if (!account) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (account.status !== 'RESTRINGIDA') {
      throw new BadRequestException('El usuario no está restringido');
    }
    account.status = 'ACTIVA';
    account.restrictionReason = undefined;
    this.auditService.record({
      actor,
      action: AuditAction.ADMIN_ACTION,
      entity: 'UserAccount',
      entityId: account.id,
      result: AuditResult.EXITOSO,
      detail: 'Restricción de cuenta levantada',
    });
    return account;
  }

  /** HU-053: retorna todas las cuentas de usuario para la moderación del administrador. */
  getAllUsers(): UserAccount[] {
    return Array.from(this.users.values());
  }

  private toPublicUser(account: UserAccount): RegisteredUserDto {
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      status: account.status,
      createdAt: account.createdAt,
    };
  }

  async login(credentials: LoginDto): Promise<LoginResponseDto> {
    const normalizedEmail = credentials.email?.trim().toLowerCase();
    const existing = normalizedEmail ? this.users.get(normalizedEmail) : undefined;

    if (!existing || !this.verifyPassword(credentials.password, existing.passwordHash)) {
      this.recordAudit(
        normalizedEmail,
        AuditAction.LOGIN,
        AuditResult.FALLIDO,
        AuthService.GENERIC_LOGIN_ERROR,
      );
      throw new UnauthorizedException(AuthService.GENERIC_LOGIN_ERROR);
    }

    if (existing.status === 'RESTRINGIDA') {
      this.recordAudit(
        existing.email,
        AuditAction.LOGIN,
        AuditResult.FALLIDO,
        'Cuenta restringida',
      );
      const reasonSuffix = existing.restrictionReason
        ? `: ${existing.restrictionReason}`
        : '';
      throw new ForbiddenException(
        `Acceso denegado: tu cuenta se encuentra restringida${reasonSuffix}`,
      );
    }

    const timeoutMinutes = Number(
      this.configService?.get<string>('SESSION_TIMEOUT_MINUTES') ??
        process.env.SESSION_TIMEOUT_MINUTES ??
        60,
    );

    const token = `jwt-${existing.id}-${existing.role}-${randomBytes(8).toString('hex')}`;
    this.activeSessions.set(token, {
      token,
      userId: existing.id,
      email: existing.email,
      role: existing.role,
      expiresAt: Date.now() + timeoutMinutes * 60 * 1000,
    });

    this.recordAudit(existing.email, AuditAction.LOGIN, AuditResult.EXITOSO);

    return {
      message: 'Inicio de sesión exitoso',
      token,
      expiresInMinutes: timeoutMinutes,
      user: this.toPublicUser(existing),
    };
  }

  async logout(rawToken?: string): Promise<LogoutResponseDto> {
    const cleanToken = rawToken?.replace(/^Bearer\s+/i, '').trim();
    const session = cleanToken ? this.activeSessions.get(cleanToken) : undefined;

    if (cleanToken) {
      this.activeSessions.delete(cleanToken);
    }

    this.recordAudit(session?.email, AuditAction.LOGOUT, AuditResult.EXITOSO);

    return {
      message: 'Sesión cerrada e invalidada correctamente',
    };
  }

  getSession(rawToken?: string): ActiveSession | undefined {
    const cleanToken = rawToken?.replace(/^Bearer\s+/i, '').trim();
    if (!cleanToken) {
      return undefined;
    }
    const session = this.activeSessions.get(cleanToken);
    if (!session) {
      return undefined;
    }
    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(cleanToken);
      return undefined;
    }
    // HU-053 CA1: sesión inválida si el usuario fue restringido
    const account = this.findByEmail(session.email);
    if (account && account.status === 'RESTRINGIDA') {
      this.activeSessions.delete(cleanToken);
      return undefined;
    }
    return session;
  }

  isSessionValid(rawToken?: string): boolean {
    return Boolean(this.getSession(rawToken));
  }

  authorize(rawToken: string | undefined, requiredRoles: Role[]): ActiveSession {
    const session = this.getSession(rawToken);
    if (!session) {
      this.recordAudit(
        undefined,
        AuditAction.ACCESS_DENIED,
        AuditResult.FALLIDO,
        'Sin sesión activa',
      );
      throw new UnauthorizedException(
        'Debes iniciar sesión para acceder a este recurso',
      );
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(session.role)) {
      this.recordAudit(
        session.email,
        AuditAction.ACCESS_DENIED,
        AuditResult.FALLIDO,
        'Rol no autorizado para la función',
      );
      throw new ForbiddenException(
        'Acceso denegado: no cuentas con el rol requerido para esta función',
      );
    }

    return session;
  }

  async register(userData: RegisterDto) {
    if ((userData.role as Role) === Role.ADMINISTRADOR) {
      this.recordAudit(
        userData.email?.trim().toLowerCase(),
        AuditAction.REGISTER,
        AuditResult.FALLIDO,
        'Intento de registro público con rol ADMINISTRADOR',
      );
      throw new ForbiddenException(
        'No está permitido asignarse el rol ADMINISTRADOR mediante el registro público',
      );
    }

    if (userData.role !== Role.HUESPED && userData.role !== Role.ANFITRION) {
      throw new BadRequestException(
        'Solo puedes elegir el rol HUESPED o ANFITRION',
      );
    }

    if (!this.isPasswordCompliant(userData.password)) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres y combinar letras y números',
      );
    }

    const normalizedEmail = userData.email.trim().toLowerCase();
    if (this.users.has(normalizedEmail)) {
      throw new ConflictException('El correo electrónico ya está en uso');
    }

    const newUser: UserAccount = {
      id: `user-${this.users.size + 1}`,
      name: userData.name.trim(),
      email: normalizedEmail,
      phone: userData.phone?.trim() || undefined,
      passwordHash: this.hashPassword(userData.password),
      role: userData.role,
      status: 'ACTIVA',
      createdAt: new Date(),
    };

    this.users.set(normalizedEmail, newUser);
    this.recordAudit(normalizedEmail, AuditAction.REGISTER, AuditResult.EXITOSO);

    return {
      message: 'Cuenta creada exitosamente',
      user: this.toPublicUser(newUser),
    };
  }
}
