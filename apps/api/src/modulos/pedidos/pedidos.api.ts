// src/modulos/pedidos/pedidos.api.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';

export interface PedidoFacturable {
  pedidoId: string; clienteId: string; condicionPago: 'CONTADO' | 'CREDITO';
  subtotal: number; impuestos: number; total: number;
  lineas: { articuloId: string; descripcion: string; cantidad: number; precioUnitario: number; ivaPct: number; totalLinea: number }[];
}

@Injectable()
export class PedidosApi {
  constructor(private readonly bd: BaseDatos) {}
  async obtenerParaFacturar(empresaId: string, pedidoId: string): Promise<PedidoFacturable | null> {
    const [p] = await this.bd.consultar(
      `SELECT * FROM pedidos.pedido WHERE id=$1 AND empresa_id=$2 AND estado IN ('CONFIRMADO','DESPACHADO')`, [pedidoId, empresaId]);
    if (!p) return null;
    const ls = await this.bd.consultar(`SELECT * FROM pedidos.pedido_linea WHERE pedido_id=$1 AND eliminado_en IS NULL`, [pedidoId]);
    return {
      pedidoId, clienteId: p.cliente_id, condicionPago: p.condicion_pago,
      subtotal: Number(p.subtotal), impuestos: Number(p.impuestos), total: Number(p.total),
      lineas: ls.map((l: any) => ({ articuloId: l.articulo_id, descripcion: l.descripcion, cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precio_unitario), ivaPct: Number(l.iva_pct), totalLinea: Number(l.total_linea) })),
    };
  }
}
