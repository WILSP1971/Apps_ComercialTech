import { Module } from '@nestjs/common';
import { SeguridadCasosUso } from './aplicacion/seguridad.casos-uso';
import { SeguridadController } from './presentacion/seguridad.controller';

@Module({ controllers: [SeguridadController], providers: [SeguridadCasosUso] })
export class SeguridadModule {}
