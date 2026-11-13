// src/modulos/despacho/aplicacion/despacho.consultas.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';

const ESTADOS = ['PROGRAMADO', 'DESPACHADO', 'ENTREGADO', 'FALLIDO', 'CANCELADO'];

@Injectable()
export class DespachoConsultas {
  constructor(private readonly bd: BaseDatos) {}

  listar(empresaId: string, f: { estado?: string; pedidoId?: string; limite?: number }) {
    const estado = f.estado && ESTADOS.includes(f.estado) ? f.estado : null;
    return this.bd.consultar(
      `SELECT d.id, d.numero, d.pedido_id, d.cliente_id, d.estado, d.direccion_entrega, d.transportador, d.guia,
              d.fecha_programada, d.despachado_en, d.entregado_en, d.intentos_entrega, d.creado_en
         FROM despacho.despacho d
        WHERE d.empresa_id=$1 AND d.eliminado_en IS NULL AND ($2::text IS NULL OR d.estado=$2) AND ($3::uuid IS NULL OR d.pedido_id=$3)
        ORDER BY d.creado_en DESC LIMIT $4`, [empresaId, estado, f.pedidoId ?? null, Math.min(f.limite ?? 100, 500)]);
  }

  async obtener(empresaId: string, id: string) {
    const [d] = await this.bd.consultar(
      `SELECT * FROM despacho.despacho WHERE id=$1 AND empresa_id=$2 AND eliminado_en IS NULL`, [id, empresaId]);
    if (!d) return null;
    const lineas = await this.bd.consultar(
      `SELECT id, pedido_linea_id, articulo_id, cantidad, reserva_id FROM despacho.despacho_linea
        WHERE despacho_id=$1 AND eliminado_en IS NULL ORDER BY creado_en`, [id]);
    return { ...d, lineas };
  }

  /** Pedidos confirmados con mercadería reservada lista para sacar de bodega (vista despacho.v_listo_para_despachar). */
  listosParaDespachar(empresaId: string, bodegaId?: string) {
    return this.bd.consultar(
      `SELECT pedido_id, bodega_id, pedido_linea_id, articulo_id, reserva_id, cantidad
         FROM despacho.v_listo_para_despachar
        WHERE empresa_id=$1 AND ($2::uuid IS NULL OR bodega_id=$2) ORDER BY pedido_id, pedido_linea_id`, [empresaId, bodegaId ?? null]);
  }
}
