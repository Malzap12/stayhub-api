import { OutgoingMail } from '../mail/mail.service';

/** HU-004A RNF: escapa los datos del usuario antes de insertarlos en el HTML del correo. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.codePointAt(0)};`);

export const RECOVERY_SUBJECT = 'Recupera tu contraseña · Inversiones LR';
export const PASSWORD_CHANGED_SUBJECT = 'Tu contraseña fue cambiada · Inversiones LR';

export const recoveryBody = (name: string, ttlMinutes: number): string =>
  `Hola ${name}, usa este enlace de un solo uso para definir una nueva contraseña. Vence en ${ttlMinutes} minutos.`;

/** HU-004A CA1: correo con el enlace de un solo uso hacia la aplicación web. */
export const recoveryMail = (to: string, name: string, link: string, ttlMinutes: number): OutgoingMail => ({
  to,
  subject: RECOVERY_SUBJECT,
  text: `${recoveryBody(name, ttlMinutes)}\n\n${link}\n\nSi no solicitaste este cambio, ignora este correo.`,
  html: `<p>Hola ${escapeHtml(name)},</p>
<p>Recibimos una solicitud para recuperar tu contraseña en Inversiones LR.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#1d1d1f;color:#ffffff;text-decoration:none;font-weight:600">Definir nueva contraseña</a></p>
<p>El enlace es de un solo uso y vence en ${ttlMinutes} minutos.</p>
<p>Si no solicitaste este cambio, ignora este correo: tu contraseña no cambiará.</p>`,
});

/** HU-004A CA5: aviso posterior al cambio de contraseña. */
export const passwordChangedMail = (to: string): OutgoingMail => ({
  to,
  subject: PASSWORD_CHANGED_SUBJECT,
  text: 'Tu contraseña de Inversiones LR se cambió correctamente. Si no fuiste tú, recupera tu cuenta de inmediato.',
  html: '<p>Tu contraseña de Inversiones LR se cambió correctamente.</p><p>Si no fuiste tú, recupera tu cuenta de inmediato.</p>',
});
