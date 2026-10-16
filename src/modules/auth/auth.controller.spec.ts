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

describe('AuthController & AuthService (HU-001, HU-002, HU-005)', () => {
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
                SESSION_TIMEOUT_MINUTES: '60',
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
    it('CA1 & RNF-001: should create an ACTIVA account with hashed password', async () => {
      const regResult = await controller.register({
        name: 'Miguel Ángel Alza',
        email: 'miguel@stayhub.com',
        password: 'Password123',
        role: Role.ANFITRION,
      });

      expect(regResult.user.email).toBe('miguel@stayhub.com');
      expect(regResult.user.role).toBe(Role.ANFITRION);
      expect(regResult.user.status).toBe('ACTIVA');
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
  });

  describe('HU-002 · Iniciar y cerrar sesión (CA1, CA2, CA3, CA4, RN-021, RNF-003)', () => {
    it('CA1 & RNF-003: should authenticate active user, return role and configurable expiration', async () => {
      await controller.register({
        name: 'Huésped Activo',
        email: 'huesped@stayhub.com',
        password: 'Password123',
        role: Role.HUESPED,
      });

      const loginRes = await controller.login({
        email: 'huesped@stayhub.com',
        password: 'Password123',
      });

      expect(loginRes.token).toContain('jwt-');
      expect(loginRes.expiresInMinutes).toBe(60);
      expect(loginRes.user.role).toBe(Role.HUESPED);
      expect(service.isSessionValid(loginRes.token)).toBe(true);
    });

    it('CA2: should reject incorrect email or password with identical generic message', async () => {
      await expect(
        controller.login({
          email: 'noexiste@stayhub.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Correo electrónico o contraseña incorrectos'),
      );

      await expect(
        controller.login({
          email: 'admin.test@inversioneslr.com',
          password: 'WrongPassword123',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Correo electrónico o contraseña incorrectos'),
      );
    });

    it('CA3: should deny login when account is RESTRINGIDA indicating restriction', async () => {
      await controller.register({
        name: 'Usuario Restringido',
        email: 'restringido@stayhub.com',
        password: 'Password123',
        role: Role.ANFITRION,
      });

      service.restrictAccount('restringido@stayhub.com', 'Publicación engañosa');

      await expect(
        controller.login({
          email: 'restringido@stayhub.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('CA4 & RN-021: should invalidate active session on logout and record audit events', async () => {
      const loginRes = await controller.login({
        email: 'admin.test@inversioneslr.com',
        password: 'TestAdminPassword2026!',
      });

      expect(service.isSessionValid(`Bearer ${loginRes.token}`)).toBe(true);

      const logoutRes = await controller.logout(`Bearer ${loginRes.token}`);
      expect(logoutRes.message).toContain('invalidada');
      expect(service.isSessionValid(loginRes.token)).toBe(false);
      expect(service.isSessionValid(undefined)).toBe(false);
      expect(service.verifyPassword('any', 'malformed-hash')).toBe(false);
      expect(service.getAuditEvents().length).toBeGreaterThan(0);
    });
  });

  describe('HU-003 · Proteger las funciones por rol (CA1, CA2, CA3)', () => {
    it('CA1: should reject unauthenticated access to protected operations with 401 Unauthorized', () => {
      expect(() => service.authorize(undefined, [Role.HUESPED])).toThrow(
        UnauthorizedException,
      );
      expect(() =>
        service.authorize('Bearer invalid-token', [Role.HUESPED]),
      ).toThrow(UnauthorizedException);
    });

    it('CA2: should deny HUESPED when invoking ANFITRION or ADMINISTRADOR functions with 403 Forbidden', async () => {
      await controller.register({
        name: 'Huésped Prueba',
        email: 'huesped.rbac@stayhub.com',
        password: 'Password123',
        role: Role.HUESPED,
      });

      const guestLogin = await controller.login({
        email: 'huesped.rbac@stayhub.com',
        password: 'Password123',
      });

      expect(() =>
        service.authorize(`Bearer ${guestLogin.token}`, [Role.ANFITRION]),
      ).toThrow(ForbiddenException);

      expect(() =>
        service.authorize(`Bearer ${guestLogin.token}`, [Role.ADMINISTRADOR]),
      ).toThrow(ForbiddenException);

      const allowedSession = service.authorize(`Bearer ${guestLogin.token}`, [
        Role.HUESPED,
      ]);
      expect(allowedSession.role).toBe(Role.HUESPED);
    });

    it('CA2: should allow ADMINISTRADOR to access admin audit events', () => {
      const events = controller.getAdminAuditEvents();
      expect(Array.isArray(events)).toBe(true);
    });
  });
});

