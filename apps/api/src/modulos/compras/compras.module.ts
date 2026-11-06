import { Module, OnModuleInit } from '@nestjs/common';
import { RegistroComandosSync } from '../sincronizacion';
import { ComprasCasosUso } from './aplicacion/compras.casos-uso';
import { ComprasController } from './presentacion/compras.controller';

@Module({ controllers: [ComprasController], providers: [ComprasCasosUso] })
export class ComprasModule implements OnModuleInit {
  constructor(private readonly sync: RegistroComandosSync, private readonly casos: ComprasCasosUso) {}

  onModuleInit() {
    this.sync.registrar('compras.orden.guardar_borrador', async (u, datos) => this.casos.guardarBorrador(u, datos));
    this.sync.registrar('compras.recepcion.registrar', async (u, datos) => this.casos.registrarRecepcion(u, datos));
  }
}
