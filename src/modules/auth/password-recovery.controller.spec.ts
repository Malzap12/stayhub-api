import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-004 · Recuperar la contraseña (simulado) (CA1, CA2, CA3, CA4, RF-006)', () => {
  let controller: PasswordRecoveryController;
  let authService: AuthService;
  let auditService: AuditService;

  const EMAIL = 'olvido@stayhub.com';
  const OLD_PASSWORD = 'Password123';
  const NEW_PASSWORD = 'NuevaClave2026';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PasswordRecoveryController],
      providers: [
        PasswordRecoveryService,
        AuthService,
        AuditService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ({ PASSWORD_RESET_TOKEN_MINUTES: '15' })[key] },
        },
      ],
    }).compile();

    controller = module.get(PasswordRecoveryController);
    authService = module.get(AuthService);
    auditService = module.get(AuditService);
    authService.onModuleInit();

    await authService.register({
      name: 'Usuario Olvidadizo',
      email: EMAIL,
      password: OLD_PASSWORD,
      role: Role.HUESPED,
    });
  });

  afterEach(() => jest.useRealTimers());

  const requestToken = (): string => {
    controller.requestRecovery({ email: EMAIL });
    return controller.getMailbox(EMAIL)[0].token;
  };

  const expectRejectedToken = (token: string) => {
    let thrown: unknown;
    try {
      controller.resetPassword({ token, newPassword: NEW_PASSWORD });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      message: PasswordRecoveryService.INVALID_TOKEN_MESSAGE,
      canRequestNewToken: true,
    });
  };

  describe('CA1 · Token de un solo uso con vencimiento en el buzón simulado', () => {
    it('deja en el buzón un mensaje con token y fecha de vencimiento configurable', () => {
      const before = Date.now();
      const response = controller.requestRecovery({ email: '  OLVIDO@stayhub.com ' });

      expect(response.message).toBe(PasswordRecoveryService.REQUEST_CONFIRMATION);
      const mailbox = controller.getMailbox(EMAIL);
      expect(mailbox).toHaveLength(1);
      expect(mailbox[0].to).toBe(EMAIL);
      expect(mailbox[0].token).toMatch(/^[a-f0-9]{64}$/);

      const ttl = Date.parse(mailbox[0].expiresAt) - before;
      expect(ttl).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
      expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    });

    it('una nueva solicitud invalida el token anterior', () => {
      const firstToken = requestToken();
      const secondToken = requestToken();

      expect(secondToken).not.toBe(firstToken);
      expect(controller.getMailbox(EMAIL)[0].token).toBe(secondToken);
      expectRejectedToken(firstToken);
      expect(controller.resetPassword({ token: secondToken, newPassword: NEW_PASSWORD }).message).toContain(
        'actualizada',
      );
    });
  });

  describe('CA2 · Nueva contraseña con token válido', () => {
    it('actualiza la contraseña, invalida el token y cierra las sesiones activas', async () => {
      const login = await authService.login({ email: EMAIL, password: OLD_PASSWORD });
      const token = requestToken();

      const response = controller.resetPassword({ token, newPassword: NEW_PASSWORD });

      expect(response.message).toContain('actualizada');
      const account = authService.findByEmail(EMAIL)!;
      expect(authService.verifyPassword(NEW_PASSWORD, account.passwordHash)).toBe(true);
      expect(authService.verifyPassword(OLD_PASSWORD, account.passwordHash)).toBe(false);
      expect(authService.isSessionValid(login.token)).toBe(false);
      expectRejectedToken(token);

      const [event] = auditService.findAll({
        action: AuditAction.PASSWORD_RESET,
        result: AuditResult.EXITOSO,
      });
      expect(event).toMatchObject({ actor: EMAIL, entityId: account.id });
    });

    it('rechaza una contraseña fuera de política sin consumir el token', () => {
      const token = requestToken();

      expect(() => controller.resetPassword({ token, newPassword: 'solotexto' })).toThrow(
        PasswordRecoveryService.PASSWORD_POLICY_MESSAGE,
      );
      expect(controller.resetPassword({ token, newPassword: NEW_PASSWORD }).message).toContain(
        'actualizada',
      );
    });
  });

  describe('CA3 · Token vencido o usado', () => {
    it('rechaza el token vencido y ofrece solicitar uno nuevo', () => {
      jest.useFakeTimers({ now: new Date('2026-10-20T10:00:00.000Z') });
      const token = requestToken();

      jest.setSystemTime(new Date('2026-10-20T10:16:00.000Z'));

      expectRejectedToken(token);
      const account = authService.findByEmail(EMAIL)!;
      expect(authService.verifyPassword(OLD_PASSWORD, account.passwordHash)).toBe(true);
    });

    it('rechaza un token inexistente y registra el intento fallido', () => {
      expectRejectedToken('token-inventado');

      const [event] = auditService.findAll({
        action: AuditAction.PASSWORD_RESET,
        result: AuditResult.FALLIDO,
      });
      expect(event).toBeDefined();
    });
  });

  describe('CA4 · Correo no registrado', () => {
    it('responde el mismo mensaje sin generar token ni revelar si el correo existe', () => {
      const registered = controller.requestRecovery({ email: EMAIL });
      const unknown = controller.requestRecovery({ email: 'nadie@stayhub.com' });

      expect(unknown).toEqual(registered);
      expect(controller.getMailbox('nadie@stayhub.com')).toEqual([]);

      const [event] = auditService.findAll({
        action: AuditAction.PASSWORD_RECOVERY_REQUEST,
        result: AuditResult.FALLIDO,
      });
      expect(event.actor).toBe('nadie@stayhub.com');
    });
  });
});
