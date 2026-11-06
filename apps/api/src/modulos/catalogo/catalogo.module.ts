import { Module, OnModuleInit } from '@nestjs/common';
import { RegistroComandosSync } from '../sincronizacion';
import { CatalogoCasosUso } from './aplicacion/catalogo.casos-uso';
import { CatalogoController } from './presentacion/catalogo.controller';

@Module({ controllers: [CatalogoController], providers: [CatalogoCasosUso] })
export class CatalogoModule implements OnModuleInit {
  constructor(private readonly sync: RegistroComandosSync, private readonly casos: CatalogoCasosUso) {}

  onModuleInit() {
    // Los clientes también se pueden crear desde el mostrador sin conexión
    this.sync.registrar('catalogo.cliente.guardar', async (u, datos) => this.casos.guardarCliente(u.empresaId, datos));
  }
}
