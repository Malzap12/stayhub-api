import { SetMetadata } from '@nestjs/common';

export const LOG_OPERATION_KEY = 'LOG_OPERATION_KEY';

export type SupportedOperation =
  | 'autenticacion'
  | 'publicacion'
  | 'reserva'
  | 'cancelacion'
  | 'reseña'
  | 'administracion'
  | string;

/**
 * Decorador para clasificar explícitamente la operación para logs estructurados (HU-062 · CA1).
 */
export const LogOperation = (operation: SupportedOperation) =>
  SetMetadata(LOG_OPERATION_KEY, operation);
