import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { MailService, OutgoingMail } from '../mail/mail.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { Role } from '../../common/enums/role.enum';

describe('HU-004A · Recuperar la contraseña por correo electrónico (CA1–CA6)', () => {
  let controller: PasswordRecoveryController;
  let authService: AuthService;
  let auditService: AuditService;
  let sent: OutgoingMail[];
  let sendResult: boolean;

  const EMAIL = 'paola@stayhub.com';
  const NEW_PASSWORD = 'NuevaClave2026';

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const tokenFromLastMail = () => {
    const match = /token=([a-f0-9]{64})/.exec(sent[sent.length - 1].text);
    return match![1];
  };

  beforeEach(async () => {
    sent = [];
    sendResult = true;
    const mailServiceMock = {
      delivery: 'EMAIL',
      appBaseUrl: 'https://app.inversioneslr.com',
      send: jest.fn(async (mail: OutgoingMail) => {
        sent.push(mail);
        return sendResult;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PasswordRecoveryController],
      providers: [
        PasswordRecoveryService,
        AuthService,
        AuditService,
        { provide: MailService, useValue: mailServiceMock },
      ],
    }).compile();

    controller = module.get(PasswordRecoveryController);
    authService = module.get(AuthService);
    auditService = module.get(AuditService);
    authService.onModuleInit();
    await authService.register({
      name: 'Paola <León>',
      email: EMAIL,
      password: 'Password123',
      role: Role.HUESPED,
    });
  });

  describe('CA1 · El enlace llega al correo registrado', () => {
    it('envía un correo con enlace de un solo uso hacia la aplicación web', async () => {
      const response = controller.requestRecovery({ email: EMAIL });
      await flush();

      expect(response).toEqual({
        message: PasswordRecoveryService.REQUEST_CONFIRMATION,
        delivery: 'EMAIL',
      });
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(EMAIL);
      expect(sent[0].text).toMatch(
        /https:\/\/app\.inversioneslr\.com\/auth\/recuperar\?token=[a-f0-9]{64}/,
      );
      expect(sent[0].html).toContain('Definir nueva contraseña');
      expect(sent[0].html).toContain('Paola &#60;León&#62;');

      const [event] = auditService.findAll({ action: AuditAction.PASSWORD_RECOVERY_REQUEST });
      expect(event).toMatchObject({ result: AuditResult.EXITOSO, detail: 'Enlace enviado por correo' });
    });

    it('no expone el enlace en el buzón simulado cuando hay correo real', async () => {
      controller.requestRecovery({ email: EMAIL });
      await flush();
      expect(controller.getMailbox(EMAIL)).toEqual([]);
    });

    it('registra como fallido el envío que el servidor SMTP rechaza', async () => {
      sendResult = false;
      controller.requestRecovery({ email: EMAIL });
      await flush();

      const [event] = auditService.findAll({ action: AuditAction.PASSWORD_RECOVERY_REQUEST });
      expect(event).toMatchObject({ result: AuditResult.FALLIDO, detail: 'Error al enviar el correo' });
    });
  });

  describe('CA2 · Abrir el enlace permite definir la nueva contraseña', () => {
    it('valida el enlace sin consumirlo y luego cambia la contraseña', async () => {
      controller.requestRecovery({ email: EMAIL });
      await flush();
      const token = tokenFromLastMail();

      expect(controller.getTokenStatus(token)).toMatchObject({ valid: true });
      expect(controller.getTokenStatus(token).valid).toBe(true);

      controller.resetPassword({ token, newPassword: NEW_PASSWORD });
      const account = authService.findByEmail(EMAIL)!;
      expect(authService.verifyPassword(NEW_PASSWORD, account.passwordHash)).toBe(true);
    });
  });

  describe('CA3 · Enlace vencido o usado', () => {
    it('informa que el enlace usado ya no es válido', async () => {
      controller.requestRecovery({ email: EMAIL });
      await flush();
      const token = tokenFromLastMail();
      controller.resetPassword({ token, newPassword: NEW_PASSWORD });

      expect(controller.getTokenStatus(token)).toEqual({
        valid: false,
        message: PasswordRecoveryService.INVALID_TOKEN_MESSAGE,
      });
      expect(() => controller.resetPassword({ token, newPassword: 'OtraClave2026' })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('CA4 · Correo no registrado', () => {
    it('responde igual y no envía ningún correo', async () => {
      const unknown = controller.requestRecovery({ email: 'nadie@stayhub.com' });
      await flush();

      expect(unknown).toEqual(controller.requestRecovery({ email: EMAIL }));
      await flush();
      expect(sent.map((mail) => mail.to)).toEqual([EMAIL]);
    });
  });

  describe('CA5 · Aviso de cambio de contraseña', () => {
    it('envía un correo de confirmación después del cambio', async () => {
      controller.requestRecovery({ email: EMAIL });
      await flush();
      controller.resetPassword({ token: tokenFromLastMail(), newPassword: NEW_PASSWORD });
      await flush();

      expect(sent[sent.length - 1]).toMatchObject({
        to: EMAIL,
        subject: 'Tu contraseña fue cambiada · Inversiones LR',
      });
    });
  });

  describe('CA6 · Límite de solicitudes', () => {
    it('ignora en silencio las solicitudes que superan el límite y responde igual', async () => {
      const responses = [1, 2, 3, 4].map(() => controller.requestRecovery({ email: EMAIL }));
      await flush();

      expect(new Set(responses.map((item) => JSON.stringify(item))).size).toBe(1);
      expect(sent).toHaveLength(3);
      const [event] = auditService.findAll({ result: AuditResult.FALLIDO });
      expect(event.detail).toBe('Límite de solicitudes alcanzado');
    });
  });

  describe('RNF · Seguridad del token', () => {
    it('guarda solo el hash: el hash del token no sirve como enlace', async () => {
      controller.requestRecovery({ email: EMAIL });
      await flush();
      const hashed = createHash('sha256').update(tokenFromLastMail()).digest('hex');

      expect(controller.getTokenStatus(hashed).valid).toBe(false);
      expect(controller.getTokenStatus('').valid).toBe(false);
    });
  });
});
