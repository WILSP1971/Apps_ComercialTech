import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { BaseDatos } from './infraestructura/base-datos';
import { BusEventos, DespachadorOutbox, PublicadorEventos } from './infraestructura/eventos';
import { SaludController } from './infraestructura/salud.controller';
import { SincronizacionModule } from './modulos/sincronizacion';
import { SeguridadModule } from './modulos/seguridad/seguridad.module';
import { CatalogoModule } from './modulos/catalogo/catalogo.module';
import { InventariosModule } from './modulos/inventarios';
import { PedidosModule } from './modulos/pedidos/pedidos.module';
import { FabricacionModule } from './modulos/fabricacion/fabricacion.module';
import { CajaModule } from './modulos/caja/caja.module';
import { FacturacionModule } from './modulos/facturacion/facturacion.module';
import { ComprasModule } from './modulos/compras/compras.module';
import { DespachoModule } from './modulos/despacho/despacho.module';

@Global()
@Module({
  controllers: [SaludController],
  providers: [
    { provide: Pool, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) },
    BaseDatos, BusEventos, PublicadorEventos, DespachadorOutbox,
  ],
  exports: [BaseDatos, BusEventos, PublicadorEventos],
})
export class NucleoModule {}

@Module({
  imports: [
    NucleoModule, SincronizacionModule, SeguridadModule, CatalogoModule, InventariosModule,
    PedidosModule, FabricacionModule, CajaModule, FacturacionModule, ComprasModule, DespachoModule,
  ],
})
export class AppModule {}
