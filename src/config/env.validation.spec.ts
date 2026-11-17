import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validProd = {
    NODE_ENV: 'production',
    DATABASE_HOST: 'postgres',
    DATABASE_PASSWORD: 'una-clave-segura-db',
    ADMIN_INITIAL_EMAIL: 'admin@ejemplo.com',
    ADMIN_INITIAL_PASSWORD: 'ClaveAdminSegura2026',
    APP_BASE_URL: 'https://stayhub.ejemplo.com',
    SMTP_HOST: 'smtp.ejemplo.com',
    CORS_ORIGINS: 'https://stayhub.ejemplo.com',
  };

  it('no valida nada fuera de producción', () => {
    expect(validateEnv({ NODE_ENV: 'development' })).toEqual({ NODE_ENV: 'development' });
  });

  it('acepta una configuración de producción completa', () => {
    expect(validateEnv({ ...validProd })).toEqual(validProd);
  });

  it('rechaza producción sin SMTP_HOST (evita el buzón simulado)', () => {
    expect(() => validateEnv({ ...validProd, SMTP_HOST: '' })).toThrow(/SMTP_HOST/);
  });

  it('rechaza la contraseña de administrador de ejemplo', () => {
    expect(() => validateEnv({ ...validProd, ADMIN_INITIAL_PASSWORD: 'AdminLr2026!' })).toThrow(
      /ADMIN_INITIAL_PASSWORD/,
    );
  });

  it('rechaza la contraseña de base de datos de ejemplo', () => {
    expect(() => validateEnv({ ...validProd, DATABASE_PASSWORD: 'lr_password123' })).toThrow(/DATABASE_PASSWORD/);
  });

  it('exige https en APP_BASE_URL', () => {
    expect(() => validateEnv({ ...validProd, APP_BASE_URL: 'http://localhost:4200' })).toThrow(/https/);
  });

  it('rechaza PERSIST_STATE=false', () => {
    expect(() => validateEnv({ ...validProd, PERSIST_STATE: 'false' })).toThrow(/PERSIST_STATE/);
  });
});
