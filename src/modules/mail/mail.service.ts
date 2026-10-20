import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export type MailDelivery = 'EMAIL' | 'SIMULATED';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * HU-004A · Envío de correos transaccionales.
 * Usa SMTP cuando SMTP_HOST está configurado; si no, la aplicación
 * conserva el buzón simulado de la HU-004 (MAIL_DELIVERY = SIMULATED).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(@Optional() private readonly configService?: ConfigService) {}

  private env(key: string): string | undefined {
    return this.configService?.get<string>(key) ?? process.env[key];
  }

  get delivery(): MailDelivery {
    return this.env('SMTP_HOST') ? 'EMAIL' : 'SIMULATED';
  }

  get appBaseUrl(): string {
    let url = this.env('APP_BASE_URL') ?? 'http://localhost:4200';
    while (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    return url;
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const user = this.env('SMTP_USER');
      this.transporter = createTransport({
        host: this.env('SMTP_HOST'),
        port: Number(this.env('SMTP_PORT') ?? 587),
        secure: this.env('SMTP_SECURE') === 'true',
        auth: user ? { user, pass: this.env('SMTP_PASS') } : undefined,
      });
    }
    return this.transporter;
  }

  /** Envía el correo; devuelve false si el servidor SMTP lo rechaza, sin propagar el error. */
  async send(mail: OutgoingMail): Promise<boolean> {
    try {
      await this.getTransporter().sendMail({
        from: this.env('MAIL_FROM') ?? 'Inversiones LR <no-reply@inversioneslr.com>',
        ...mail,
      });
      return true;
    } catch (error) {
      this.logger.error(`No se pudo enviar el correo: ${(error as Error).message}`);
      return false;
    }
  }
}
