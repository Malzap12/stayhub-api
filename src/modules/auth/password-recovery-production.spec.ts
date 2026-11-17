import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordRecoveryService } from './password-recovery.service';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';

describe('Recuperación de contraseña en producción: el buzón simulado no expone tokens', () => {
  const originalEnv = process.env.NODE_ENV;
  let service: PasswordRecoveryService;
  let authService: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PasswordRecoveryService,
        AuthService,
        AuditService,
        { provide: MailService, useValue: { delivery: 'SIMULATED', appBaseUrl: 'https://x', send: jest.fn() } },
      ],
    }).compile();
    service = module.get(PasswordRecoveryService);
    authService = module.get(AuthService);
    authService.onModuleInit();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('GET mailbox responde 404 en producción', () => {
    process.env.NODE_ENV = 'production';
    expect(() => service.getMailbox('admin@inversioneslr.com')).toThrow(NotFoundException);
  });

  it('sin SMTP en producción no guarda el token en el buzón', () => {
    process.env.NODE_ENV = 'production';
    service.requestRecovery('admin@inversioneslr.com');
    process.env.NODE_ENV = 'development';
    expect(service.getMailbox('admin@inversioneslr.com')).toEqual([]);
  });

  it('fuera de producción el buzón simulado sigue funcionando', () => {
    process.env.NODE_ENV = 'development';
    service.requestRecovery('admin@inversioneslr.com');
    expect(service.getMailbox('admin@inversioneslr.com')).toHaveLength(1);
  });
});
