import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ActiveSession } from '../../modules/auth/auth.service';

/** Sesión autenticada que RolesGuard adjunta a la petición. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession | undefined =>
    context.switchToHttp().getRequest()?.user,
);
