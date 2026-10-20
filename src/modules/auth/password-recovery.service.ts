import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResult } from '../../common/enums/audit.enum';
import { MessageResponseDto, SimulatedMailDto } from './dto/password-recovery.dto';

interface PasswordResetToken {
  token: string;
  email: string;
  expiresAt: number;
  used: boolean;
}

/**
 * HU-004 · Recuperar la contraseña (simulado) · RF-006.
 * Los enlaces se entregan en un buzón simulado en memoria, sin correo real (AMB-33, SUP-11).
 */
@Injectable()
export class PasswordRecoveryService {
  static readonly REQUEST_CONFIRMATION =
    'Si el correo está registrado, recibirás un enlace de recuperación en tu buzón.';
  static readonly INVALID_TOKEN_MESSAGE =
    'El enlace de recuperación no es válido, venció o ya fue usado. Solicita uno nuevo.';
  static readonly PASSWORD_POLICY_MESSAGE =
    'La contraseña debe tener al menos 8 caracteres y combinar letras y números';

  private readonly tokens: Map<string, PasswordResetToken> = new Map();
  private readonly mailbox: SimulatedMailDto[] = [];

  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  private get tokenTtlMinutes(): number {
    return Number(
      this.configService?.get<string>('PASSWORD_RESET_TOKEN_MINUTES') ??
        process.env.PASSWORD_RESET_TOKEN_MINUTES ??
        30,
    );
  }

  /** CA1 y CA4: genera un token de un solo uso con vencimiento y responde siempre igual. */
  requestRecovery(rawEmail: string): MessageResponseDto {
    const email = rawEmail?.trim().toLowerCase();
    const account = email ? this.authService.findByEmail(email) : undefined;

    if (!account) {
      this.auditService.record({
        actor: email,
        action: AuditAction.PASSWORD_RECOVERY_REQUEST,
        entity: 'UserAccount',
        result: AuditResult.FALLIDO,
        detail: 'Correo no registrado',
      });
      return { message: PasswordRecoveryService.REQUEST_CONFIRMATION };
    }

    for (const pending of this.tokens.values()) {
      if (pending.email === account.email) {
        pending.used = true;
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.tokenTtlMinutes * 60 * 1000;
    this.tokens.set(token, { token, email: account.email, expiresAt, used: false });

    this.mailbox.push({
      id: randomUUID(),
      to: account.email,
      subject: 'Recupera tu contraseña · Inversiones LR',
      body: `Hola ${account.name}, usa este enlace de un solo uso para definir una nueva contraseña. Vence en ${this.tokenTtlMinutes} minutos.`,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      sentAt: new Date().toISOString(),
    });

    this.auditService.record({
      actor: account.email,
      action: AuditAction.PASSWORD_RECOVERY_REQUEST,
      entity: 'UserAccount',
      entityId: account.id,
      result: AuditResult.EXITOSO,
    });

    return { message: PasswordRecoveryService.REQUEST_CONFIRMATION };
  }

  /** Buzón simulado: mensajes recibidos por un correo, del más reciente al más antiguo. */
  getMailbox(rawEmail: string): SimulatedMailDto[] {
    const email = rawEmail?.trim().toLowerCase();
    return this.mailbox.filter((mail) => mail.to === email).reverse();
  }

  /** CA2 y CA3: cambia la contraseña con un token vigente y lo invalida. */
  resetPassword(rawToken: string, newPassword: string): MessageResponseDto {
    const resetToken = this.tokens.get(rawToken?.trim());

    if (!resetToken || resetToken.used || Date.now() > resetToken.expiresAt) {
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

    this.auditService.record({
      actor: resetToken.email,
      action: AuditAction.PASSWORD_RESET,
      entity: 'UserAccount',
      entityId: this.authService.findByEmail(resetToken.email)?.id,
      result: AuditResult.EXITOSO,
    });

    return { message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' };
  }
}
