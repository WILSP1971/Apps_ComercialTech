import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';

@Injectable()
export class SeguimientoPedido {
  constructor(private readonly bd: BaseDatos) {}

  /** Cliente web: solo puede ver SUS pedidos (el clienteId sale del token, nunca del cuerpo). */
  async obtener(empresaId: string, clienteId: string, pedidoId: string) {
    const [p] = await this.bd.consultar(
      `SELECT id, numero, estado, total, motivo_rechazo, creado_en FROM pedidos.pedido
        WHERE id=$1 AND empresa_id=$2 AND cliente_id=$3 AND eliminado_en IS NULL`, [pedidoId, empresaId, clienteId]);
    if (!p) return null;
    const lineas = await this.bd.consultar(
      `SELECT descripcion, cantidad, cantidad_reservada, cantidad_a_fabricar, estado_abastecimiento
         FROM pedidos.pedido_linea WHERE pedido_id=$1 AND eliminado_en IS NULL`, [pedidoId]);
    return { ...p, lineas };
  }
}
