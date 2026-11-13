// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FiltroErrores } from './infraestructura/filtro-errores';

async function arrancar() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new FiltroErrores());
  app.enableCors({ origin: [process.env.WEB_ORIGIN ?? 'http://localhost:3000'], credentials: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
arrancar();
