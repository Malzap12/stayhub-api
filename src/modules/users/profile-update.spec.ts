import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthService, ActiveSession } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';
import { ChangePasswordDto, UpdateProfileDto } from './dto/update-profile.dto';

describe('HU-007 · Actualizar mi perfil (CA1, CA2, CA3, RF-010, RN-021)', () => {
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

  const registerAndLogin = async (email: string, phone?: string): Promise<ActiveSession> => {
    await authService.register({ name: 'Laura Gómez', email, password: 'Password123', role: Role.HUESPED, phone });
    const { token } = await authService.login({ email, password: 'Password123' });
    return authService.getSession(token) as ActiveSession;
  };

  const lastAudit = (action: AuditAction) => auditService.findAll({ action }).at(-1);

  const validationErrors = async <T extends object>(type: new () => T, body: object) =>
    (await validate(plainToInstance(type, body), { whitelist: true, forbidNonWhitelisted: true })).flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

  describe('CA1 · Edito nombre o teléfono, se refleja en mi perfil y se registra el evento', () => {
    it('actualiza nombre y teléfono y los muestra en el perfil', async () => {
      const session = await registerAndLogin('laura@stayhub.com');

      const updated = controller.updateMyProfile({ name: '  Laura Gómez Ruiz ', phone: '+57 300 123 4567' }, session);

      expect(updated).toMatchObject({ name: 'Laura Gómez Ruiz', phone: '+57 300 123 4567' });
      expect(controller.getMyProfile(session)).toMatchObject({ name: 'Laura Gómez Ruiz', phone: '+57 300 123 4567' });
    });

    it('registra el evento con los campos que cambiaron (RN-021)', async () => {
      const session = await registerAndLogin('auditada@stayhub.com');

      controller.updateMyProfile({ name: 'Laura Gómez', phone: '3001234567' }, session);

      expect(lastAudit(AuditAction.PROFILE_UPDATE)).toMatchObject({
        actor: 'auditada@stayhub.com',
        entity: 'UserAccount',
        entityId: session.userId,
        result: AuditResult.EXITOSO,
        detail: 'Campos actualizados: teléfono',
      });
    });

    it('permite quitar el teléfono enviando null o vacío', async () => {
      const session = await registerAndLogin('con.telefono@stayhub.com', '3001234567');

      expect(controller.updateMyProfile({ phone: '' }, session).phone).toBeNull();
    });

    it('sin cambios responde 400 y no registra evento', async () => {
      const session = await registerAndLogin('igual@stayhub.com');

      expect(() => controller.updateMyProfile({ name: 'Laura Gómez' }, session)).toThrow(
        new BadRequestException('No hay cambios para guardar'),
      );
      expect(() => controller.updateMyProfile({}, session)).toThrow(BadRequestException);
      expect(lastAudit(AuditAction.PROFILE_UPDATE)).toBeUndefined();
    });

    it('rechaza un nombre vacío o un teléfono inválido', async () => {
      expect(await validationErrors(UpdateProfileDto, { name: '   ' })).toContain('El nombre completo no puede quedar vacío');
      expect(await validationErrors(UpdateProfileDto, { phone: 'abc123' })).toEqual([
        expect.stringContaining('teléfono válido'),
      ]);
      expect(await validationErrors(UpdateProfileDto, { name: 'Laura', phone: null })).toEqual([]);
    });
  });

  describe('CA2 · Cambio la contraseña con la actual y una nueva que cumple la política', () => {
    it('actualiza la contraseña, conserva la sesión actual y cierra las demás', async () => {
      const session = await registerAndLogin('clave@stayhub.com');
      const { token: otherToken } = await authService.login({ email: 'clave@stayhub.com', password: 'Password123' });

      expect(
        controller.changeMyPassword({ currentPassword: 'Password123', newPassword: 'NuevaClave2026' }, session),
      ).toEqual({ message: 'Contraseña actualizada correctamente' });

      await expect(authService.login({ email: 'clave@stayhub.com', password: 'NuevaClave2026' })).resolves.toBeDefined();
      expect(authService.isSessionValid(session.token)).toBe(true);
      expect(authService.isSessionValid(otherToken)).toBe(false);
      expect(lastAudit(AuditAction.PASSWORD_CHANGE)).toMatchObject({ result: AuditResult.EXITOSO });
    });

    it('rechaza la contraseña actual incorrecta y lo registra', async () => {
      const session = await registerAndLogin('equivocada@stayhub.com');

      expect(() =>
        controller.changeMyPassword({ currentPassword: 'Otra12345', newPassword: 'NuevaClave2026' }, session),
      ).toThrow(new BadRequestException('La contraseña actual no es correcta'));
      expect(lastAudit(AuditAction.PASSWORD_CHANGE)).toMatchObject({
        result: AuditResult.FALLIDO,
        detail: 'Contraseña actual incorrecta',
      });
    });

    it('rechaza una nueva contraseña que no cumple la política o es igual a la actual', async () => {
      const session = await registerAndLogin('politica@stayhub.com');

      expect(() => controller.changeMyPassword({ currentPassword: 'Password123', newPassword: 'corta' }, session)).toThrow(
        BadRequestException,
      );
      expect(() =>
        controller.changeMyPassword({ currentPassword: 'Password123', newPassword: 'Password123' }, session),
      ).toThrow(new BadRequestException('La nueva contraseña debe ser diferente de la actual'));
      expect(await validationErrors(ChangePasswordDto, { currentPassword: 'x', newPassword: 'SoloLetras' })).toContain(
        'La contraseña debe tener al menos 8 caracteres y combinar letras y números',
      );
    });
  });

  describe('CA3 · El correo y el rol no se pueden editar', () => {
    it('rechaza el intento de cambiar correo o rol', async () => {
      const errors = await validationErrors(UpdateProfileDto, { email: 'otro@stayhub.com', role: Role.ADMINISTRADOR });

      expect(errors).toEqual(
        expect.arrayContaining(['El correo electrónico no se puede editar', 'El rol no se puede editar']),
      );
    });
  });
});
