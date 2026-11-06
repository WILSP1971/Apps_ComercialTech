// src/modulos/inventarios/inventarios.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos, PublicadorEventos } from '../../infraestructura/eventos';
import { InventariosApi } from './inventarios.api';

@Module({ providers: [InventariosApi], exports: [InventariosApi] })
export class InventariosModule implements OnModuleInit {
  constructor(
    private readonly bus: BusEventos, private readonly bd: BaseDatos,
    private readonly api: InventariosApi, private readonly eventos: PublicadorEventos,
  ) {}

  onModuleInit() {
    // Cancelación de pedido => se liberan las reservas
    this.bus.suscribir('pedidos.PedidoCancelado', (e) => this.api.liberarPorPedido(e.empresa_id, e.payload.pedidoId));

    // Compras: entrada al kardex por cada línea recibida (idempotente por línea de recepción)
    this.bus.suscribir('compras.RecepcionRegistrada', async (e) => {
      await this.bd.transaccion(async () => {
        for (const l of e.payload.lineas) {
          await this.api.asentarKardex({
            empresaId: e.empresa_id, articuloId: l.articuloId, bodegaId: e.payload.bodegaId, tipo: 'ENTRADA_COMPRA',
            deltaFisico: l.cantidad, costoUnitario: l.costoUnitario,
            referenciaTipo: 'compras.recepcion', referenciaId: e.payload.recepcionId, idempotencia: `recepcion-linea:${l.recepcionLineaId}`,
          });
        }
      });
    });

    // Fabricación: entra producto terminado y se reserva para la línea del pedido que originó la OF
    this.bus.suscribir('fabricacion.OrdenFabricacionTerminada', async (e) => {
      const o = e.payload;                       // { ordenId, articuloId, bodegaId, cantidad, pedidoId?, pedidoLineaId? }
      await this.bd.transaccion(async () => {
        await this.api.asentarKardex({
          empresaId: e.empresa_id, articuloId: o.articuloId, bodegaId: o.bodegaId, tipo: 'ENTRADA_PRODUCCION',
          deltaFisico: o.cantidad, referenciaTipo: 'fabricacion.orden', referenciaId: o.ordenId, idempotencia: `of:${o.ordenId}:entrada`,
        });
        if (!o.pedidoLineaId) return;
        await this.api.reservar({
          empresaId: e.empresa_id, articuloId: o.articuloId, bodegaId: o.bodegaId, cantidad: o.cantidad,
          pedidoId: o.pedidoId, pedidoLineaId: o.pedidoLineaId, origen: `of-${o.ordenId}`,
        });
        const [t] = await this.bd.consultar(
          `SELECT COALESCE(sum(cantidad),0) AS total FROM inventarios.reserva_stock
            WHERE pedido_linea_id=$1 AND estado IN ('ACTIVA','CONSUMIDA')`, [o.pedidoLineaId]);
        await this.eventos.publicar([{
          tipo: 'inventarios.StockReservadoPorProduccion', agregadoId: o.pedidoLineaId, empresaId: e.empresa_id, ocurrioEn: new Date(),
          datos: { pedidoLineaId: o.pedidoLineaId, reservadaTotal: Number(t.total) },
        }]);
      });
    });
  }
}
