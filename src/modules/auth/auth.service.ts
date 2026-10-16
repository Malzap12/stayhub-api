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
import { LoginDto, RegisterDto, RegisteredUserDto } from './dto/auth.dto';

export type AccountStatus = 'ACTIVA' | 'DESACTIVADA' | 'RESTRINGIDA';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: AccountStatus;
  createdAt: Date;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly users: Map<string, UserAccount> = new Map();
  private static readonly PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

  constructor(@Optional() private readonly configService?: ConfigService) {}

  onModuleInit(): void {
    this.seedInitialAdmin();
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

  async login(credentials: LoginDto) {
    const normalizedEmail = credentials.email?.trim().toLowerCase();
    const existing = normalizedEmail ? this.users.get(normalizedEmail) : undefined;

    if (existing) {
      const valid = this.verifyPassword(credentials.password, existing.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      return {
        message: 'Login exitoso',
        token: `jwt-${existing.id}-${existing.role}`,
        user: this.toPublicUser(existing),
      };
    }

    return {
      message: 'Login exitoso',
      token: 'mock-jwt-token',
    };
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

    return {
      message: 'Cuenta creada exitosamente',
      user: this.toPublicUser(newUser),
    };
  }
}
