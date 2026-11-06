import { Inject, Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import {
  CLIENTE_CREDITO_REPOSITORIO, ClienteCreditoRepositorio, PEDIDO_REPOSITORIO, PedidoRepositorio,
} from '../dominio/pedido';

@Injectable()
export class CancelarPedido {
  constructor(
    @Inject(PEDIDO_REPOSITORIO) private readonly pedidos: PedidoRepositorio,
    @Inject(CLIENTE_CREDITO_REPOSITORIO) private readonly clientes: ClienteCreditoRepositorio,
    private readonly bd: BaseDatos,
    private readonly eventos: PublicadorEventos,
  ) {}

  async ejecutar(cmd: { empresaId: string; pedidoId: string }) {
    return this.bd.transaccion(async () => {
      const pedido = await this.pedidos.obtener(cmd.pedidoId, cmd.empresaId);
      if (!pedido) throw new ErrorNegocio('PEDIDO_NO_EXISTE', 'El pedido no existe');
      if (pedido.estado === 'CANCELADO') return { estado: 'CANCELADO' };           // idempotente

      const eraConfirmado = pedido.estado === 'CONFIRMADO';
      const r = pedido.cancelar();
      if (!r.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', r.error);

      // Un pedido a crédito ya confirmado había consumido cupo: se devuelve (R13)
      if (eraConfirmado && pedido.snapshot.condicionPago === 'CREDITO') {
        const cliente = await this.clientes.obtener(pedido.snapshot.clienteId, cmd.empresaId);
        if (cliente) { cliente.liberar(pedido.total().valor); await this.clientes.guardar(cliente); }
      }
      await this.pedidos.guardar(pedido);
      await this.eventos.publicar(pedido.extraerEventos());     // Inventarios libera las reservas
      return { estado: 'CANCELADO' };
    });
  }
}
