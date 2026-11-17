import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { createAppValidationPipe } from './common/pipes/app-validation.pipe';
import { isProduction } from './config/env.validation';
import { AppModule } from './app.module';

/** Orígenes permitidos por CORS: lista separada por comas en CORS_ORIGINS; sin valor, cualquier origen (solo desarrollo). */
function corsOrigins(): string[] | boolean {
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : !isProduction();
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás de Caddy y nginx (redes privadas de Docker): toma la IP real del cliente de X-Forwarded-For,
  // necesaria para que el límite de peticiones se aplique por usuario y no al proxy.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');

  app.setGlobalPrefix('api');
  // Guarda el estado en PostgreSQL al detener el contenedor (StatePersistenceService).
  app.enableShutdownHooks();
  app.enableCors({ origin: corsOrigins() });

  const swaggerEnabled = process.env.ENABLE_SWAGGER
    ? process.env.ENABLE_SWAGGER === 'true'
    : !isProduction();
  // La interfaz de Swagger necesita scripts en línea: la CSP estricta solo se aplica cuando está desactivada.
  app.use(helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined }));

  app.useGlobalPipes(createAppValidationPipe());

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Inversiones LR - API Marketplace')
      .setDescription('Especificación OpenAPI de los servicios del Marketplace de Alojamientos')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`API escuchando en el puerto ${port} (prefijo /api)`);
  if (swaggerEnabled) {
    logger.log('Documentación Swagger disponible en /api/docs');
  }
}
bootstrap();
