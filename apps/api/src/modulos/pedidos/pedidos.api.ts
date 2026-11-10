// src/modulos/pedidos/pedidos.api.ts   (API pública del módulo Pedidos)
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';

export interface PedidoFacturable {
  pedidoId: string; clienteId: string; condicionPago: 'CONTADO' | 'CREDITO';
  subtotal: number; impuestos: number; total: number;
  lineas: { articuloId: string; descripcion: string; cantidad: number; precioUnitario: number; ivaPct: number; totalLinea: number }[];
}

/** Lo mínimo que Despacho necesita de un pedido (evita que Despacho lea tablas de otro esquema). */
export interface PedidoDespachable {
  pedidoId: string; numero: string | null; clienteId: string; bodegaId: string;
  estado: string; direccionEntrega: string | null;
  lineas: { id: string; articuloId: string; descripcion: string; cantidad: number }[];
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

  async obtenerParaDespachar(empresaId: string, pedidoId: string): Promise<PedidoDespachable | null> {
    const [p] = await this.bd.consultar(
      `SELECT p.id, p.numero, p.cliente_id, p.bodega_id, p.estado, p.direccion_entrega
         FROM pedidos.pedido p WHERE p.id=$1 AND p.empresa_id=$2 AND p.eliminado_en IS NULL`, [pedidoId, empresaId]);
    if (!p) return null;
    const ls = await this.bd.consultar(
      `SELECT id, articulo_id, descripcion, cantidad FROM pedidos.pedido_linea
        WHERE pedido_id=$1 AND eliminado_en IS NULL ORDER BY creado_en, id`, [pedidoId]);
    return {
      pedidoId: p.id, numero: p.numero, clienteId: p.cliente_id, bodegaId: p.bodega_id, estado: p.estado,
      direccionEntrega: p.direccion_entrega ?? null,
      lineas: ls.map((l: any) => ({ id: l.id, articuloId: l.articulo_id, descripcion: l.descripcion, cantidad: Number(l.cantidad) })),
    };
  }
}
