import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Role } from '../../common/enums/role.enum';
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

export interface AuthAuditEvent {
  actor: string;
  action: 'REGISTER' | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_RESTRICTED' | 'LOGOUT';
  entity: string;
  timestamp: Date;
  result: 'SUCCESS' | 'DENIED';
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly users: Map<string, UserAccount> = new Map();
  private readonly activeSessions: Map<string, ActiveSession> = new Map();
  private readonly auditEvents: AuthAuditEvent[] = [];
  private static readonly PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  private static readonly GENERIC_LOGIN_ERROR =
    'Correo electrónico o contraseña incorrectos';

  constructor(@Optional() private readonly configService?: ConfigService) {}

  onModuleInit(): void {
    this.seedInitialAdmin();
  }

  private recordAudit(
    actor: string,
    action: AuthAuditEvent['action'],
    result: AuthAuditEvent['result'],
  ): void {
    this.auditEvents.push({
      actor,
      action,
      entity: 'AuthSession',
      timestamp: new Date(),
      result,
    });
  }

  getAuditEvents(): AuthAuditEvent[] {
    return [...this.auditEvents];
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

  getAdmins(): UserAccount[] {
    return Array.from(this.users.values()).filter(
      (user) => user.role === Role.ADMINISTRADOR,
    );
  }

  findByEmail(email: string): UserAccount | undefined {
    return this.users.get(email.trim().toLowerCase());
  }

  restrictAccount(email: string, reason = 'Incumplimiento de políticas'): void {
    const account = this.findByEmail(email);
    if (account) {
      account.status = 'RESTRINGIDA';
      account.restrictionReason = reason;
    }
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
      this.recordAudit(normalizedEmail || 'anonymous', 'LOGIN_FAILED', 'DENIED');
      throw new UnauthorizedException(AuthService.GENERIC_LOGIN_ERROR);
    }

    if (existing.status === 'RESTRINGIDA') {
      this.recordAudit(existing.email, 'LOGIN_RESTRICTED', 'DENIED');
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

    this.recordAudit(existing.email, 'LOGIN_SUCCESS', 'SUCCESS');

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

    this.recordAudit(session?.email || 'authenticated-user', 'LOGOUT', 'SUCCESS');

    return {
      message: 'Sesión cerrada e invalidada correctamente',
    };
  }

  isSessionValid(rawToken?: string): boolean {
    const cleanToken = rawToken?.replace(/^Bearer\s+/i, '').trim();
    if (!cleanToken) {
      return false;
    }
    const session = this.activeSessions.get(cleanToken);
    if (!session) {
      return false;
    }
    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(cleanToken);
      return false;
    }
    return true;
  }

  async register(userData: RegisterDto) {
    if ((userData.role as Role) === Role.ADMINISTRADOR) {
      throw new ForbiddenException(
        'No está permitido asignarse el rol ADMINISTRADOR mediante el registro público',
      );
    }

    if (userData.role !== Role.HUESPED && userData.role !== Role.ANFITRION) {
      throw new BadRequestException(
        'Solo puedes elegir el rol HUESPED o ANFITRION',
      );
    }

    if (!userData.password || !AuthService.PASSWORD_REGEX.test(userData.password)) {
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
      passwordHash: this.hashPassword(userData.password),
      role: userData.role,
      status: 'ACTIVA',
      createdAt: new Date(),
    };

    this.users.set(normalizedEmail, newUser);
    this.recordAudit(normalizedEmail, 'REGISTER', 'SUCCESS');

    return {
      message: 'Cuenta creada exitosamente',
      user: this.toPublicUser(newUser),
    };
  }
}
