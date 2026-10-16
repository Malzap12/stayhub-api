import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Role } from '../../common/enums/role.enum';

describe('AuthController & AuthService (HU-005)', () => {
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

  describe('CA1 · Cuenta ADMINISTRADOR creada en la configuración inicial desde variables de entorno', () => {
    it('should seed at least one ADMINISTRADOR account with credentials from env vars', () => {
      const admins = service.getAdmins();
      expect(admins.length).toBeGreaterThanOrEqual(1);
      expect(admins[0].email).toBe('admin.test@inversioneslr.com');
      expect(admins[0].password).toBe('TestAdminPassword2026!');
      expect(admins[0].role).toBe(Role.ADMINISTRADOR);
    });

    it('should be idempotent and not duplicate admin when seedInitialAdmin is called again', () => {
      const firstSeed = service.seedInitialAdmin();
      const secondSeed = service.seedInitialAdmin();
      expect(firstSeed.email).toBe(secondSeed.email);
      expect(service.getAdmins().length).toBe(1);
    });
  });

  describe('CA2 · Visitante en registro público no puede obtener rol ADMINISTRADOR', () => {
    it('should allow registering with HUESPED or ANFITRION role', async () => {
      const result = await controller.register({
        name: 'Miguel Ángel Alza',
        email: 'miguel@stayhub.com',
        password: 'Password123!',
        role: Role.ANFITRION,
      });
      expect(result).toBeDefined();
      expect(result.user.email).toBe('miguel@stayhub.com');
      expect(result.user.role).toBe(Role.ANFITRION);
    });

    it('should reject registration attempt with ADMINISTRADOR role', async () => {
      await expect(
        controller.register({
          name: 'Intruso Admin',
          email: 'intruso@stayhub.com',
          password: 'Password123!',
          role: Role.ADMINISTRADOR as unknown as Role.ANFITRION,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('should login user and return JWT token', async () => {
    const result = await controller.login({
      email: 'admin.test@inversioneslr.com',
      password: 'TestAdminPassword2026!',
    });
    expect(result).toBeDefined();
    expect(result.token).toBeDefined();
  });
});
