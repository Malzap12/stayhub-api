import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createAppValidationPipe } from './common/pipes/app-validation.pipe';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  // Guarda los datos en disco al detener el contenedor (StatePersistenceService).
  app.enableShutdownHooks();
  app.enableCors();

  app.useGlobalPipes(createAppValidationPipe());

  const config = new DocumentBuilder()
    .setTitle('Inversiones LR - API Marketplace')
    .setDescription('Especificación OpenAPI de los servicios del Marketplace de Alojamientos')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Servidor corriendo en: http://localhost:${port}/api`);
  console.log(`Documentación Swagger en: http://localhost:${port}/api/docs`);
}
bootstrap();
