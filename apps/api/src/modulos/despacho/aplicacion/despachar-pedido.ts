// src/modulos/despacho/aplicacion/despachar-pedido.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { InventariosApi } from '../../inventarios';

@Injectable()
export class DespacharPedido {
  constructor(private readonly bd: BaseDatos, private readonly inv: InventariosApi, private readonly eventos: PublicadorEventos) {}

  /** Bodeguero. R12: sin reserva ACTIVA no hay despacho (InventariosApi lanza R12_SIN_RESERVA_ACTIVA). */
  async ejecutar(u: { empresaId: string; id: string }, d: { despachoId: string; pedidoId: string; direccionEntrega: string }) {
    return this.bd.transaccion(async () => {
      const [ya] = await this.bd.consultar(`SELECT id FROM despacho.despacho WHERE id=$1 AND empresa_id=$2`, [d.despachoId, u.empresaId]);
      if (ya) return {};                                                                  // reintento idempotente

      const reservas = await this.inv.reservasActivas(u.empresaId, d.pedidoId);
      if (reservas.length === 0) throw new ErrorNegocio('R12_SIN_RESERVA_ACTIVA', 'El pedido no tiene stock reservado para despachar');

      const [p] = await this.bd.consultar(`SELECT cliente_id, bodega_id FROM pedidos.pedido WHERE id=$1 AND empresa_id=$2`, [d.pedidoId, u.empresaId]);
      // ^ lectura de solo los 2 campos que Despacho necesita; en una versión más estricta se pide a PedidosApi.

      await this.inv.consumirReservas({ empresaId: u.empresaId, reservaIds: reservas.map(r => r.id), despachoId: d.despachoId, usuarioId: u.id });
      await this.bd.consultar(
        `INSERT INTO despacho.despacho (id, empresa_id, pedido_id, cliente_id, bodega_id, direccion_entrega, estado, despachado_por, despachado_en)
         VALUES ($1,$2,$3,$4,$5,$6,'DESPACHADO',$7,now())`,
        [d.despachoId, u.empresaId, d.pedidoId, p.cliente_id, p.bodega_id, d.direccionEntrega, u.id]);
      for (const r of reservas) {
        await this.bd.consultar(
          `INSERT INTO despacho.despacho_linea (id, empresa_id, despacho_id, pedido_linea_id, articulo_id, cantidad, reserva_id)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [u.empresaId, d.despachoId, r.pedido_linea_id, r.articulo_id, r.cantidad, r.id]);
      }
      const [pend] = await this.bd.consultar(
        `SELECT count(*)::int AS n FROM pedidos.pedido_linea WHERE pedido_id=$1 AND eliminado_en IS NULL AND cantidad_a_fabricar > 0`, [d.pedidoId]);
      await this.eventos.publicar([{
        tipo: 'despacho.DespachoRealizado', agregadoId: d.despachoId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { despachoId: d.despachoId, pedidoId: d.pedidoId, completo: pend.n === 0 },
      }]);
      return {};
    });
  }
}
