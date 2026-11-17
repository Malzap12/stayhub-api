/**
 * Validación de variables de entorno al arrancar.
 * En producción (NODE_ENV=production) aborta el arranque si falta configuración
 * obligatoria o si se usan las credenciales de ejemplo publicadas en el repositorio.
 */

const INSECURE_DEFAULTS: Record<string, string[]> = {
  ADMIN_INITIAL_PASSWORD: ['AdminLr2026!'],
  DATABASE_PASSWORD: ['lr_password123', 'cambiar'],
};

const REQUIRED_IN_PRODUCTION = [
  'DATABASE_HOST',
  'DATABASE_PASSWORD',
  'ADMIN_INITIAL_EMAIL',
  'ADMIN_INITIAL_PASSWORD',
  'APP_BASE_URL',
  'SMTP_HOST',
  'CORS_ORIGINS',
];

export function isProduction(env: NodeJS.ProcessEnv | Record<string, unknown> = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Datos de ejemplo (publicaciones demo): activos por defecto salvo en producción; SEED_DEMO_DATA lo fuerza. */
export function isDemoDataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SEED_DEMO_DATA === 'true') return true;
  if (env.SEED_DEMO_DATA === 'false') return false;
  return !isProduction(env);
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  if (!isProduction(config)) {
    return config;
  }

  const errors: string[] = [];
  const value = (key: string) => String(config[key] ?? '').trim();

  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!value(key)) {
      errors.push(`${key} es obligatoria en producción`);
    }
  }

  for (const [key, insecure] of Object.entries(INSECURE_DEFAULTS)) {
    if (value(key) && insecure.includes(value(key))) {
      errors.push(`${key} usa un valor de ejemplo público; define uno propio`);
    }
  }

  const adminPassword = value('ADMIN_INITIAL_PASSWORD');
  if (adminPassword && adminPassword.length < 12) {
    errors.push('ADMIN_INITIAL_PASSWORD debe tener al menos 12 caracteres en producción');
  }

  const baseUrl = value('APP_BASE_URL');
  if (baseUrl && !/^https:\/\//i.test(baseUrl)) {
    errors.push('APP_BASE_URL debe usar https:// en producción');
  }

  if (config.PERSIST_STATE === 'false') {
    errors.push('PERSIST_STATE=false desactiva PostgreSQL y perdería todos los datos al reiniciar');
  }

  if (errors.length > 0) {
    throw new Error(`Configuración de entorno inválida:\n - ${errors.join('\n - ')}`);
  }
  return config;
}
