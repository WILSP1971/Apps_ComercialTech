// src/modulos/despacho/despacho.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { InventariosModule } from '../inventarios/inventarios.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { RegistroComandosSync } from '../sincronizacion';
import { DespacharPedido } from './aplicacion/despachar-pedido';
import { DespachoConsultas } from './aplicacion/despacho.consultas';
import { ProgramarDespacho } from './aplicacion/programar-despacho';
import {
  ActualizarLogisticaDespacho, CancelarDespacho, RegistrarEntrega, RegistrarEntregaFallida, ReintentarEntrega,
} from './aplicacion/transiciones-despacho';
import { DESPACHO_REPOSITORIO, INVENTARIOS_DESPACHO_PUERTO, PEDIDOS_DESPACHO_PUERTO } from './dominio/repositorio';
import { DespachoRepositorioPg } from './infraestructura/despacho.repositorio.pg';
import { InventariosAdaptador } from './infraestructura/inventarios.adaptador';
import { PedidosAdaptador } from './infraestructura/pedidos.adaptador';
import { DespachoController } from './presentacion/despacho.controller';

@Module({
  imports: [InventariosModule, PedidosModule],        // InventariosApi y PedidosApi: solo sus APIs públicas
  controllers: [DespachoController],
  providers: [
    { provide: DESPACHO_REPOSITORIO, useClass: DespachoRepositorioPg },
    { provide: INVENTARIOS_DESPACHO_PUERTO, useClass: InventariosAdaptador },
    { provide: PEDIDOS_DESPACHO_PUERTO, useClass: PedidosAdaptador },
    DespachoConsultas, ProgramarDespacho, DespacharPedido, RegistrarEntrega, RegistrarEntregaFallida,
    ReintentarEntrega, CancelarDespacho, ActualizarLogisticaDespacho,
  ],
})
export class DespachoModule implements OnModuleInit {
  constructor(
    private readonly sync: RegistroComandosSync,
    private readonly despachar: DespacharPedido,
    private readonly entrega: RegistrarEntrega,
    private readonly fallida: RegistrarEntregaFallida,
  ) {}

  onModuleInit() {
    // El bodeguero/transportador trabaja sin conexión; el servidor valida R12 al sincronizar
    // (si la reserva ya no está activa, la operación vuelve RECHAZADA con R12_SIN_RESERVA_ACTIVA).
    this.sync.registrar('despacho.despacho.registrar', (u, datos) => this.despachar.ejecutar(u, datos));
    this.sync.registrar('despacho.despacho.entregar', (u, datos) => this.entrega.ejecutar(u, datos));
    this.sync.registrar('despacho.despacho.fallido', (u, datos) => this.fallida.ejecutar(u, datos));
  }
}
