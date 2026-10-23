import { BadRequestException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { StatePersistenceService } from '../persistence/state-persistence.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import {
  MessageResponseDto,
  RecoveryRequestResponseDto,
  SimulatedMailDto,
  TokenStatusDto,
} from './dto/password-recovery.dto';
import { passwordChangedMail, RECOVERY_SUBJECT, recoveryBody, recoveryMail } from './password-recovery.mails';

interface PasswordResetToken {
  email: string;
  expiresAt: number;
  used: boolean;
}

/**
 * HU-004 · Recuperar la contraseña (simulado) · RF-006.
 * HU-004A · Recuperar la contraseña por correo electrónico: con SMTP configurado
 * el enlace se envía al correo real; sin SMTP se usa el buzón simulado (AMB-33, SUP-11).
 */
@Injectable()
export class PasswordRecoveryService implements OnModuleInit {
  static readonly REQUEST_CONFIRMATION =
    'Si el correo está registrado, recibirás un enlace de recuperación en tu buzón.';
  static readonly INVALID_TOKEN_MESSAGE =
    'El enlace de recuperación no es válido, venció o ya fue usado. Solicita uno nuevo.';
  static readonly PASSWORD_POLICY_MESSAGE =
    'La contraseña debe tener al menos 8 caracteres y combinar letras y números';
  static readonly RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

  private readonly tokens: Map<string, PasswordResetToken> = new Map();
  private readonly mailbox: SimulatedMailDto[] = [];
  private readonly requestLog: Map<string, number[]> = new Map();

  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly persistence?: StatePersistenceService,
  ) {}

  onModuleInit(): void {
    this.persistence?.register('passwordRecovery', {
      dump: () => ({ tokens: [...this.tokens.entries()], mailbox: this.mailbox, requestLog: [...this.requestLog.entries()] }),
      restore: (data) => {
        const state = data as {
          tokens: Array<[string, PasswordResetToken]>;
          mailbox: SimulatedMailDto[];
          requestLog: Array<[string, number[]]>;
        };
        state.tokens.forEach(([key, token]) => this.tokens.set(key, token));
        this.mailbox.push(...state.mailbox);
        state.requestLog.forEach(([email, times]) => this.requestLog.set(email, times));
      },
    });
  }

  private setting(key: string, fallback: number): number {
    return Number(this.configService?.get<string>(key) ?? process.env[key] ?? fallback);
  }

  private get tokenTtlMinutes(): number {
    return this.setting('PASSWORD_RESET_TOKEN_MINUTES', 30);
  }

  private get maxRequestsPerWindow(): number {
    return this.setting('PASSWORD_RECOVERY_MAX_REQUESTS', 3);
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** El mapa se indexa por el hash del token: el valor en claro solo viaja en el enlace. */
  private findToken(rawToken?: string): PasswordResetToken | undefined {
    return rawToken ? this.tokens.get(PasswordRecoveryService.hash(rawToken.trim())) : undefined;
  }

  private static isUsable(resetToken: PasswordResetToken): boolean {
    return !resetToken.used && Date.now() <= resetToken.expiresAt;
  }

  /** HU-004A RNF: limita las solicitudes por correo dentro de la ventana configurada. */
  private isRateLimited(email: string): boolean {
    const now = Date.now();
    const recent = (this.requestLog.get(email) ?? []).filter(
      (time) => now - time < PasswordRecoveryService.RATE_LIMIT_WINDOW_MS,
    );
    recent.push(now);
    this.requestLog.set(email, recent);
    return recent.length > this.maxRequestsPerWindow;
  }

  private recordRequest(email: string | undefined, result: AuditResult, detail?: string, entityId?: string) {
    this.auditService.record({
      actor: email,
      action: AuditAction.PASSWORD_RECOVERY_REQUEST,
      entity: 'UserAccount',
      entityId,
      result,
      detail,
    });
  }

  /** CA1 y CA4: genera un token de un solo uso con vencimiento y responde siempre igual. */
  requestRecovery(rawEmail: string): RecoveryRequestResponseDto {
    const email = rawEmail?.trim().toLowerCase();
    const response: RecoveryRequestResponseDto = {
      message: PasswordRecoveryService.REQUEST_CONFIRMATION,
      delivery: this.mailService.delivery,
    };

    if (email && this.isRateLimited(email)) {
      this.recordRequest(email, AuditResult.FALLIDO, 'Límite de solicitudes alcanzado');
      return response;
    }

    const account = email ? this.authService.findByEmail(email) : undefined;
    if (!account) {
      this.recordRequest(email, AuditResult.FALLIDO, 'Correo no registrado');
      return response;
    }

    for (const pending of this.tokens.values()) {
      if (pending.email === account.email) {
        pending.used = true;
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.tokenTtlMinutes * 60 * 1000;
    this.tokens.set(PasswordRecoveryService.hash(token), { email: account.email, expiresAt, used: false });

    if (this.mailService.delivery === 'SIMULATED') {
      this.mailbox.push({
        id: randomUUID(),
        to: account.email,
        subject: RECOVERY_SUBJECT,
        body: recoveryBody(account.name, this.tokenTtlMinutes),
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        sentAt: new Date().toISOString(),
      });
      this.recordRequest(account.email, AuditResult.EXITOSO, 'Enlace en buzón simulado', account.id);
      return response;
    }

    const link = `${this.mailService.appBaseUrl}/auth/recuperar?token=${token}`;
    this.mailService
      .send(recoveryMail(account.email, account.name, link, this.tokenTtlMinutes))
      .then((sent) =>
        this.recordRequest(
          account.email,
          sent ? AuditResult.EXITOSO : AuditResult.FALLIDO,
          sent ? 'Enlace enviado por correo' : 'Error al enviar el correo',
          account.id,
        ),
      )
      .catch(() => undefined);

    return response;
  }

  /** Buzón simulado: solo disponible sin SMTP, para no exponer enlaces de correos reales. */
  getMailbox(rawEmail: string): SimulatedMailDto[] {
    if (this.mailService.delivery !== 'SIMULATED') {
      return [];
    }
    const email = rawEmail?.trim().toLowerCase();
    return this.mailbox.filter((mail) => mail.to === email).reverse();
  }

  /** HU-004A: indica si el enlace sigue vigente sin consumirlo ni revelar la cuenta. */
  getTokenStatus(rawToken: string): TokenStatusDto {
    const resetToken = this.findToken(rawToken);
    return resetToken && PasswordRecoveryService.isUsable(resetToken)
      ? { valid: true, expiresAt: new Date(resetToken.expiresAt).toISOString() }
      : { valid: false, message: PasswordRecoveryService.INVALID_TOKEN_MESSAGE };
  }

  /** CA2 y CA3: cambia la contraseña con un token vigente y lo invalida. */
  resetPassword(rawToken: string, newPassword: string): MessageResponseDto {
    const resetToken = this.findToken(rawToken);

    if (!resetToken || !PasswordRecoveryService.isUsable(resetToken)) {
      this.auditService.record({
        actor: resetToken?.email,
        action: AuditAction.PASSWORD_RESET,
        entity: 'UserAccount',
        result: AuditResult.FALLIDO,
        detail: PasswordRecoveryService.INVALID_TOKEN_MESSAGE,
      });
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: PasswordRecoveryService.INVALID_TOKEN_MESSAGE,
        canRequestNewToken: true,
      });
    }

    if (!this.authService.isPasswordCompliant(newPassword)) {
      throw new BadRequestException(PasswordRecoveryService.PASSWORD_POLICY_MESSAGE);
    }

    this.authService.updatePassword(resetToken.email, newPassword);
    resetToken.used = true;

    const account = this.authService.findByEmail(resetToken.email);
    this.auditService.record({
      actor: resetToken.email,
      action: AuditAction.PASSWORD_RESET,
      entity: 'UserAccount',
      entityId: account?.id,
      result: AuditResult.EXITOSO,
    });

    if (this.mailService.delivery === 'EMAIL') {
      void this.mailService.send(passwordChangedMail(resetToken.email));
    }

    return { message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' };
  }
}
