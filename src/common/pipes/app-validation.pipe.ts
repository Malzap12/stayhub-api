import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

export type FieldErrors = Record<string, string[]>;

function collectFieldErrors(errors: ValidationError[], parent = '', acc: FieldErrors = {}): FieldErrors {
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      acc[field] = Object.values(error.constraints);
    }
    if (error.children?.length) {
      collectFieldErrors(error.children, field, acc);
    }
  }
  return acc;
}

/**
 * ValidationPipe global: además de `message` (lista plana), responde `fieldErrors`
 * agrupado por campo para mostrar cada mensaje junto a su campo (HU-010 CA2).
 */
export function createAppValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const fieldErrors = collectFieldErrors(errors);
      return new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: Object.values(fieldErrors).flat(),
        fieldErrors,
      });
    },
  });
}
