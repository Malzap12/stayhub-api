import { ForbiddenException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../common/enums/role.enum';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  createdAt: Date;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly users: Map<string, UserAccount> = new Map();

  constructor(@Optional() private readonly configService?: ConfigService) {}

  onModuleInit(): void {
    this.seedInitialAdmin();
  }

  seedInitialAdmin(): UserAccount {
    const adminEmail =
      this.configService?.get<string>('ADMIN_INITIAL_EMAIL') ??
      process.env.ADMIN_INITIAL_EMAIL ??
      'admin@inversioneslr.com';
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
      password: adminPassword,
      role: Role.ADMINISTRADOR,
      createdAt: new Date(),
    };

    this.users.set(adminEmail.toLowerCase(), initialAdmin);
    return initialAdmin;
  }

  getAdmins(): UserAccount[] {
    return Array.from(this.users.values()).filter(
      (user) => user.role === Role.ADMINISTRADOR,
    );
  }

  async login(credentials: LoginDto) {
    return { message: 'Login exitoso', token: 'mock-jwt-token' };
  }

  async register(userData: RegisterDto) {
    if ((userData.role as Role) === Role.ADMINISTRADOR) {
      throw new ForbiddenException(
        'No está permitido asignarse el rol ADMINISTRADOR mediante el registro público',
      );
    }

    const newUser: UserAccount = {
      id: `user-${this.users.size + 1}`,
      name: userData.name,
      email: userData.email,
      password: userData.password,
      role: userData.role,
      createdAt: new Date(),
    };

    this.users.set(userData.email.toLowerCase(), newUser);

    return { message: 'Usuario registrado correctamente', user: userData };
  }
}
