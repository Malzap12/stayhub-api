import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

async function generateOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Inversiones LR - API Marketplace')
    .setDescription('Especificación OpenAPI 3.0 de los servicios del Marketplace de Alojamientos (HU-066)')
    .setVersion('1.0.0')
    .addServer('http://localhost:3000', 'Ambiente Local / Pruebas')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outputDir = path.resolve(process.cwd(), 'docs');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), { encoding: 'utf8' });

  await app.close();
  console.log(`Contrato OpenAPI generado exitosamente en: ${outputPath}`);
}

generateOpenApi();
