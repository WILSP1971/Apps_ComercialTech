// src/modulos/pedidos/infraestructura/cliente-credito.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { ClienteCredito } from '../dominio/cliente-credito';
import { ClienteCreditoRepositorio } from '../dominio/pedido';

@Injectable()
export class ClienteCreditoRepositorioPg implements ClienteCreditoRepositorio {
  constructor(private readonly bd: BaseDatos) {}
  async obtener(id: string, empresaId: string) {
    // FOR UPDATE: dos pedidos del mismo cliente no pueden consumir el mismo crédito a la vez (R13)
    const [c] = await this.bd.consultar(
      `SELECT * FROM pedidos.cliente WHERE id=$1 AND empresa_id=$2 AND eliminado_en IS NULL FOR UPDATE`, [id, empresaId]);
    return c ? new ClienteCredito(c.id, c.empresa_id, Number(c.limite_credito), Number(c.credito_usado), c.bloqueado) : null;
  }
  async guardar(c: ClienteCredito) {
    await this.bd.consultar(`UPDATE pedidos.cliente SET credito_usado=$2 WHERE id=$1`, [c.id, c.creditoUsado]);
  }
}
