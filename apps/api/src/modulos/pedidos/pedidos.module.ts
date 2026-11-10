// src/modulos/pedidos/pedidos.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos } from '../../infraestructura/eventos';
import { InventariosModule } from '../inventarios/inventarios.module';
import { RegistroComandosSync } from '../sincronizacion';
import { CLIENTE_CREDITO_REPOSITORIO, PEDIDO_REPOSITORIO } from './dominio/pedido';
import { PedidoRepositorioPg } from './infraestructura/pedido.repositorio.pg';
import { ClienteCreditoRepositorioPg } from './infraestructura/cliente-credito.repositorio.pg';
import { InventariosAdaptador } from './infraestructura/inventarios.adaptador';
import { INVENTARIOS_PUERTO } from './aplicacion/puertos';
import { ConfirmarPedido } from './aplicacion/confirmar-pedido';
import { AprobarPedido } from './aplicacion/aprobar-pedido';
import { GuardarBorradorPedido } from './aplicacion/guardar-borrador-pedido';
import { PedidosController } from './presentacion/pedidos.controller';
import { TiendaController } from './presentacion/tienda.controller';
import { CancelarPedido } from './aplicacion/cancelar-pedido';
import { SeguimientoPedido } from './aplicacion/seguimiento-pedido';
import { PedidosApi } from './pedidos.api';

@Module({
  imports: [InventariosModule],
  controllers: [PedidosController, TiendaController],
  providers: [
    { provide: PEDIDO_REPOSITORIO, useClass: PedidoRepositorioPg },
    { provide: CLIENTE_CREDITO_REPOSITORIO, useClass: ClienteCreditoRepositorioPg },
    { provide: INVENTARIOS_PUERTO, useClass: InventariosAdaptador },
    ConfirmarPedido, AprobarPedido, GuardarBorradorPedido, CancelarPedido, SeguimientoPedido, PedidosApi,
  ],
  exports: [PedidosApi],
})
export class PedidosModule implements OnModuleInit {
  constructor(
    private readonly bus: BusEventos, private readonly bd: BaseDatos, private readonly sync: RegistroComandosSync,
    private readonly guardar: GuardarBorradorPedido, private readonly confirmar: ConfirmarPedido,
  ) {}

  onModuleInit() {
    // 1) Comandos que llegan desde los dispositivos offline
    this.sync.registrar('pedidos.pedido.guardar_borrador', async (u, datos) => {
      await this.guardar.ejecutar(u.empresaId, u.id, datos); return {};
    });
    this.sync.registrar('pedidos.pedido.confirmar', async (u, datos: any) => ({
      ...(await this.confirmar.ejecutar({ empresaId: u.empresaId, pedidoId: datos.pedidoId, usuarioId: u.id })),
    }));

    // 2) Mantener el modelo de cliente de Pedidos a partir del catálogo (el límite de crédito lo fija el supervisor/admin)
    const upsertCliente = async (e: any) => {
      await this.bd.consultar(
        `INSERT INTO pedidos.cliente (id, empresa_id, numero_documento, razon_social)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET numero_documento=$3, razon_social=$4`,
        [e.payload.clienteId, e.empresa_id, e.payload.numeroDocumento, e.payload.razonSocial]);
    };
    this.bus.suscribir('catalogo.ClienteCreado', upsertCliente);
    this.bus.suscribir('catalogo.ClienteActualizado', upsertCliente);

    // 3) Producción terminada: Inventarios informa el total reservado de la línea (valor absoluto => idempotente)
    this.bus.suscribir('inventarios.StockReservadoPorProduccion', async (e) => {
      const { pedidoLineaId, reservadaTotal } = e.payload;
      await this.bd.consultar(
        `UPDATE pedidos.pedido_linea
            SET cantidad_reservada = LEAST(cantidad, $2),
                cantidad_a_fabricar = GREATEST(cantidad - LEAST(cantidad, $2), 0),
                estado_abastecimiento = CASE WHEN $2 >= cantidad THEN 'RESERVADO' ELSE 'MIXTO' END
          WHERE id = $1 AND empresa_id = $3`, [pedidoLineaId, reservadaTotal, e.empresa_id]);
    });

    // 4) Despacho completo => pedido DESPACHADO
    this.bus.suscribir('despacho.DespachoRealizado', async (e) => {
      if (!e.payload.completo) return;
      await this.bd.consultar(
        `UPDATE pedidos.pedido SET estado='DESPACHADO' WHERE id=$1 AND empresa_id=$2 AND estado='CONFIRMADO'`,
        [e.payload.pedidoId, e.empresa_id]);
    });
  }
}
