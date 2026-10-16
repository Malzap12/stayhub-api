import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Role } from '../../common/enums/role.enum';

describe('AuthController & AuthService (HU-001 · MA-36 & HU-005 · MA-35)', () => {
  let controller: AuthController;
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const env: Record<string, string> = {
                ADMIN_INITIAL_EMAIL: 'admin.test@inversioneslr.com',
                ADMIN_INITIAL_PASSWORD: 'TestAdminPassword2026!',
                ADMIN_INITIAL_NAME: 'Admin Inicial Test',
              };
              return env[key];
            },
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  describe('HU-005 · Administrador Inicial (CA1 & CA2)', () => {
    it('CA1: should seed at least one ADMINISTRADOR account with hashed password from env vars', () => {
      const admins = service.getAdmins();
      expect(admins.length).toBeGreaterThanOrEqual(1);
      expect(admins[0].email).toBe('admin.test@inversioneslr.com');
      expect(admins[0].role).toBe(Role.ADMINISTRADOR);
      expect(admins[0].status).toBe('ACTIVA');
      expect(admins[0].passwordHash).not.toBe('TestAdminPassword2026!');
      expect(service.verifyPassword('TestAdminPassword2026!', admins[0].passwordHash)).toBe(true);
    });

    it('CA1: should be idempotent when seedInitialAdmin is called multiple times', () => {
      const firstSeed = service.seedInitialAdmin();
      const secondSeed = service.seedInitialAdmin();
      expect(firstSeed.email).toBe(secondSeed.email);
      expect(service.getAdmins().length).toBe(1);
    });
  });

  describe('HU-001 · Registrarse en la plataforma (CA1, CA2, CA3, CA4 y RNF-001)', () => {
    it('CA1 & RNF-001: should create an ACTIVA account with hashed password and allow logging in', async () => {
      const regResult = await controller.register({
        name: 'Miguel Ángel Alza',
        email: 'miguel@stayhub.com',
        password: 'Password123',
        role: Role.ANFITRION,
      });

      expect(regResult.user.email).toBe('miguel@stayhub.com');
      expect(regResult.user.role).toBe(Role.ANFITRION);
      expect(regResult.user.status).toBe('ACTIVA');

      const stored = service.findByEmail('miguel@stayhub.com');
      expect(stored).toBeDefined();
      expect(stored?.passwordHash).not.toBe('Password123');
      expect(service.verifyPassword('Password123', stored!.passwordHash)).toBe(true);

      const loginResult = await controller.login({
        email: 'miguel@stayhub.com',
        password: 'Password123',
      });
      expect(loginResult.token).toContain('jwt-');
      expect(loginResult.user?.status).toBe('ACTIVA');
    });

    it('CA2: should reject registration with 409 Conflict when email is already in use', async () => {
      await controller.register({
        name: 'Usuario Uno',
        email: 'duplicado@stayhub.com',
        password: 'Password123',
        role: Role.HUESPED,
      });

      await expect(
        controller.register({
          name: 'Usuario Dos',
          email: 'DUPLICADO@stayhub.com',
          password: 'Password456',
          role: Role.ANFITRION,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('CA3: should reject password shorter than 8 chars or without letters and numbers', async () => {
      await expect(
        controller.register({
          name: 'Usuario Clave Corta',
          email: 'corta@stayhub.com',
          password: 'Ab1',
          role: Role.HUESPED,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.register({
          name: 'Usuario Solo Letras',
          email: 'sololetras@stayhub.com',
          password: 'SoloLetrasSinNumeros',
          role: Role.HUESPED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CA4: should reject ADMINISTRADOR or invalid roles in public registration', async () => {
      await expect(
        controller.register({
          name: 'Intruso Admin',
          email: 'intruso@stayhub.com',
          password: 'Password123',
          role: Role.ADMINISTRADOR as unknown as Role.ANFITRION,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        controller.register({
          name: 'Rol Inválido',
          email: 'invalido@stayhub.com',
          password: 'Password123',
          role: 'OTRO_ROL' as unknown as Role.HUESPED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject login with wrong password and handle malformed hash safely', async () => {
      expect(service.verifyPassword('any', 'malformed-hash')).toBe(false);

      await expect(
        controller.login({
          email: 'admin.test@inversioneslr.com',
          password: 'WrongPassword123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
