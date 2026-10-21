import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-006 · Consultar mi perfil (CA1, CA2, RF-009)', () => {
  let controller: UsersController;
  let authService: AuthService;
  let auditService: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [UsersService, AuthService, AuditService],
    }).compile();

    controller = module.get(UsersController);
    authService = module.get(AuthService);
    auditService = module.get(AuditService);
  });

  const registerAndLogin = async (
    email: string,
    phone?: string,
    role: Role.HUESPED | Role.ANFITRION = Role.HUESPED,
  ): Promise<ActiveSession> => {
    await authService.register({ name: 'Laura Gómez', email, password: 'Password123', role, phone });
    const { token } = await authService.login({ email, password: 'Password123' });
    return authService.getSession(token) as ActiveSession;
  };

  describe('CA1 · Veo nombre, correo, teléfono, rol y estado de la cuenta', () => {
    it('retorna los datos básicos del usuario autenticado', async () => {
      const session = await registerAndLogin('laura@stayhub.com', ' +57 300 123 4567 ', Role.ANFITRION);

      expect(controller.getMyProfile(session)).toEqual({
        id: session.userId,
        name: 'Laura Gómez',
        email: 'laura@stayhub.com',
        phone: '+57 300 123 4567',
        role: Role.ANFITRION,
        status: 'ACTIVA',
        createdAt: expect.any(Date),
      });
    });

    it('el teléfono es null cuando no se registró', async () => {
      const session = await registerAndLogin('sin.telefono@stayhub.com');

      expect(controller.getMyProfile(session).phone).toBeNull();
    });

    it('no expone la contraseña ni datos internos', async () => {
      const session = await registerAndLogin('privado@stayhub.com');

      const profile = controller.getMyProfile(session);
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('restrictionReason');
    });

    it('refleja el estado actual de la cuenta', async () => {
      const session = await registerAndLogin('restringida@stayhub.com');
      authService.restrictAccount('restringida@stayhub.com');

      expect(controller.getMyProfile(session).status).toBe('RESTRINGIDA');
    });

    it('responde 404 si la cuenta de la sesión ya no existe', () => {
      const orphan: ActiveSession = {
        token: 'jwt-huerfano',
        userId: 'user-inexistente',
        email: 'nadie@stayhub.com',
        role: Role.HUESPED,
        expiresAt: Date.now() + 60_000,
      };

      expect(() => controller.getMyProfile(orphan)).toThrow(NotFoundException);
    });
  });

  describe('CA2 · No puedo consultar el perfil de otro usuario por su identificador', () => {
    it('consultar mi propio identificador retorna mi perfil', async () => {
      const session = await registerAndLogin('propio@stayhub.com');

      expect(controller.getProfileById(session.userId, session).email).toBe('propio@stayhub.com');
    });

    it('consultar el identificador de otro usuario responde 403 y queda en la auditoría', async () => {
      const laura = await registerAndLogin('laura2@stayhub.com');
      const pedro = await registerAndLogin('pedro@stayhub.com');

      expect(() => controller.getProfileById(pedro.userId, laura)).toThrow(
        new ForbiddenException('No puedes consultar el perfil de otro usuario'),
      );
      expect(auditService.findAll()).toContainEqual(
        expect.objectContaining({
          actor: 'laura2@stayhub.com',
          action: AuditAction.ACCESS_DENIED,
          entity: 'UserAccount',
          entityId: pedro.userId,
          result: AuditResult.FALLIDO,
        }),
      );
    });

    it('un identificador inexistente también responde 403, sin revelar si existe', async () => {
      const session = await registerAndLogin('curioso@stayhub.com');

      expect(() => controller.getProfileById('user-999', session)).toThrow(ForbiddenException);
    });
  });
});
