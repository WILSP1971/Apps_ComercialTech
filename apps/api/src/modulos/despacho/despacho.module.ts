import { Module, OnModuleInit } from '@nestjs/common';
import { InventariosModule } from '../inventarios/inventarios.module';
import { RegistroComandosSync } from '../sincronizacion';
import { DespacharPedido } from './aplicacion/despachar-pedido';
import { DespachoController } from './presentacion/despacho.controller';

@Module({
  imports: [InventariosModule],                   // InventariosApi: consumir reservas (R12)
  controllers: [DespachoController],
  providers: [DespacharPedido],
})
export class DespachoModule implements OnModuleInit {
  constructor(private readonly sync: RegistroComandosSync, private readonly despachar: DespacharPedido) {}

  onModuleInit() {
    // El bodeguero puede registrar el despacho sin conexión; el servidor lo acepta solo si hay reserva activa (R12)
    this.sync.registrar('despacho.despacho.registrar', async (u, datos) => this.despachar.ejecutar(u, datos));
  }
}
