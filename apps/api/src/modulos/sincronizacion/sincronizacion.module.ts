// src/modulos/sincronizacion/sincronizacion.module.ts
import { Global, Module } from '@nestjs/common';
import { AuthGuard } from '../../infraestructura/auth';
import { RegistroComandosSync } from './registro-comandos';
import { SincronizacionController } from './sincronizacion.controller';

@Global()
@Module({
  controllers: [SincronizacionController],
  providers: [RegistroComandosSync, AuthGuard],
  exports: [RegistroComandosSync, AuthGuard],
})
export class SincronizacionModule {}
