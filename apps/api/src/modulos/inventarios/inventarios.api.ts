// src/modulos/inventarios/inventarios.api.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { ErrorNegocio } from '../../kernel/errores';

export type TipoKardex = 'ENTRADA_COMPRA' | 'ENTRADA_PRODUCCION' | 'SALIDA_DESPACHO'
                       | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO' | 'RESERVA' | 'LIBERACION';

@Injectable()
export class InventariosApi {
  constructor(private readonly bd: BaseDatos) {}

  /** R5: ÚNICA vía para cambiar existencias. Un trigger aplica el asiento a inventarios.existencia. */
  async asentarKardex(a: {
    empresaId: string; articuloId: string; bodegaId: string; tipo: TipoKardex;
    deltaFisico?: number; deltaReservado?: number; costoUnitario?: number;
    referenciaTipo: string; referenciaId: string; idempotencia: string; usuarioId?: string;
  }): Promise<boolean> {
    const r = await this.bd.consultar(
      `INSERT INTO inventarios.kardex (empresa_id, articulo_id, bodega_id, tipo, delta_fisico, delta_reservado,
                                       costo_unitario, referencia_tipo, referencia_id, idempotencia, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (empresa_id, idempotencia) DO NOTHING RETURNING id`,
      [a.empresaId, a.articuloId, a.bodegaId, a.tipo, a.deltaFisico ?? 0, a.deltaReservado ?? 0,
       a.costoUnitario ?? null, a.referenciaTipo, a.referenciaId, a.idempotencia, a.usuarioId ?? null]);
    return r.length > 0;                      // false => asiento ya existía (reintento)
  }

  /** R2 y R3: reserva el MENOR entre lo pedido y lo disponible. Idempotente por clave. */
  async reservar(c: {
    empresaId: string; articuloId: string; bodegaId: string; cantidad: number;
    pedidoId: string; pedidoLineaId: string; usuarioId?: string; origen: string;
  }): Promise<{ reservaId: string | null; reservada: number }> {
    return this.bd.transaccion(async () => {
      const clave = `pedido_linea:${c.pedidoLineaId}:${c.origen}`;
      const [previa] = await this.bd.consultar(
        `SELECT id, cantidad FROM inventarios.reserva_stock WHERE empresa_id=$1 AND clave_idempotencia=$2`, [c.empresaId, clave]);
      if (previa) return { reservaId: previa.id, reservada: Number(previa.cantidad) };

      // FOR UPDATE: serializa reservas concurrentes del mismo artículo/bodega (R3)
      const [ex] = await this.bd.consultar(
        `SELECT cantidad_disponible FROM inventarios.existencia
          WHERE empresa_id=$1 AND articulo_id=$2 AND bodega_id=$3 FOR UPDATE`, [c.empresaId, c.articuloId, c.bodegaId]);
      const reservada = Math.min(c.cantidad, Math.max(Number(ex?.cantidad_disponible ?? 0), 0));
      if (reservada <= 0) return { reservaId: null, reservada: 0 };

      const [r] = await this.bd.consultar(
        `INSERT INTO inventarios.reserva_stock (empresa_id, articulo_id, bodega_id, pedido_id, pedido_linea_id, cantidad, clave_idempotencia)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [c.empresaId, c.articuloId, c.bodegaId, c.pedidoId, c.pedidoLineaId, reservada, clave]);
      await this.asentarKardex({
        empresaId: c.empresaId, articuloId: c.articuloId, bodegaId: c.bodegaId, tipo: 'RESERVA', deltaReservado: reservada,
        referenciaTipo: 'pedidos.pedido', referenciaId: c.pedidoId, idempotencia: `reserva:${r.id}`, usuarioId: c.usuarioId,
      });
      return { reservaId: r.id, reservada };
    });
  }

  /** Reservas activas de un pedido (las usa Despacho). */
  reservasActivas(empresaId: string, pedidoId: string) {
    return this.bd.consultar<{ id: string; pedido_linea_id: string; articulo_id: string; cantidad: string }>(
      `SELECT id, pedido_linea_id, articulo_id, cantidad FROM inventarios.reserva_stock
        WHERE empresa_id=$1 AND pedido_id=$2 AND estado='ACTIVA'`, [empresaId, pedidoId]);
  }

  /** R12: solo se puede despachar consumiendo reservas ACTIVAS. Si alguna no lo está, falla toda la operación. */
  async consumirReservas(c: { empresaId: string; reservaIds: string[]; despachoId: string; usuarioId?: string }) {
    const consumidas = await this.bd.consultar(
      `UPDATE inventarios.reserva_stock SET estado='CONSUMIDA', referencia_despacho=$3, actualizado_en=now()
        WHERE empresa_id=$1 AND id = ANY($2::uuid[]) AND estado='ACTIVA'
        RETURNING id, articulo_id, bodega_id, cantidad`, [c.empresaId, c.reservaIds, c.despachoId]);
    if (c.reservaIds.length === 0 || consumidas.length !== c.reservaIds.length)
      throw new ErrorNegocio('R12_SIN_RESERVA_ACTIVA', 'No se puede despachar mercadería sin una reserva de stock activa');

    for (const r of consumidas) {
      await this.asentarKardex({
        empresaId: c.empresaId, articuloId: r.articulo_id, bodegaId: r.bodega_id, tipo: 'SALIDA_DESPACHO',
        deltaFisico: -Number(r.cantidad), deltaReservado: -Number(r.cantidad),
        referenciaTipo: 'despacho.despacho', referenciaId: c.despachoId, idempotencia: `salida:${r.id}`, usuarioId: c.usuarioId,
      });
    }
  }

  /** Libera las reservas ACTIVAS de un pedido (cancelación). */
  async liberarPorPedido(empresaId: string, pedidoId: string) {
    const liberadas = await this.bd.consultar(
      `UPDATE inventarios.reserva_stock SET estado='LIBERADA', actualizado_en=now()
        WHERE empresa_id=$1 AND pedido_id=$2 AND estado='ACTIVA' RETURNING id, articulo_id, bodega_id, cantidad`,
      [empresaId, pedidoId]);
    for (const r of liberadas) {
      await this.asentarKardex({
        empresaId, articuloId: r.articulo_id, bodegaId: r.bodega_id, tipo: 'LIBERACION', deltaReservado: -Number(r.cantidad),
        referenciaTipo: 'pedidos.pedido', referenciaId: pedidoId, idempotencia: `liberacion:${r.id}`,
      });
    }
  }
}
