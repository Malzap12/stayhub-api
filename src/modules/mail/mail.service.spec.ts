import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('MailService (HU-004A)', () => {
  const sendMail = jest.fn();
  const configWith = (env: Record<string, string>) =>
    ({ get: (key: string) => env[key] }) as unknown as ConfigService;

  beforeEach(() => {
    sendMail.mockReset();
    (createTransport as jest.Mock).mockReset().mockReturnValue({ sendMail });
  });

  it('usa el buzón simulado cuando no hay SMTP_HOST', () => {
    const service = new MailService(configWith({}));
    expect(service.delivery).toBe('SIMULATED');
    expect(service.appBaseUrl).toBe('http://localhost:4200');
  });

  it('quita todas las barras finales de APP_BASE_URL', () => {
    const service = new MailService(configWith({ APP_BASE_URL: 'https://app.inversioneslr.com///' }));
    expect(service.appBaseUrl).toBe('https://app.inversioneslr.com');
  });

  it('envía por SMTP con la configuración del entorno', async () => {
    sendMail.mockResolvedValue({});
    const service = new MailService(
      configWith({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'cuenta@gmail.com',
        SMTP_PASS: 'clave-app',
        MAIL_FROM: 'Inversiones LR <cuenta@gmail.com>',
        APP_BASE_URL: 'https://app.inversioneslr.com/',
      }),
    );

    expect(service.delivery).toBe('EMAIL');
    expect(service.appBaseUrl).toBe('https://app.inversioneslr.com');
    await expect(service.send({ to: 'a@b.com', subject: 's', text: 't', html: 'h' })).resolves.toBe(true);
    await service.send({ to: 'c@d.com', subject: 's', text: 't', html: 'h' });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'cuenta@gmail.com', pass: 'clave-app' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Inversiones LR <cuenta@gmail.com>', to: 'a@b.com' }),
    );
  });

  it('permite SMTP sin autenticación (Mailpit) y devuelve false si el envío falla', async () => {
    sendMail.mockRejectedValue(new Error('connection refused'));
    const service = new MailService(configWith({ SMTP_HOST: 'mailpit', SMTP_PORT: '1025' }));

    await expect(service.send({ to: 'a@b.com', subject: 's', text: 't', html: 'h' })).resolves.toBe(false);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mailpit', port: 1025, secure: false, auth: undefined }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Inversiones LR <no-reply@inversioneslr.com>' }),
    );
  });
});
