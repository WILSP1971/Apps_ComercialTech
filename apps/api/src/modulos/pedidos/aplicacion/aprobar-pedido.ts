// src/modulos/pedidos/aplicacion/aprobar-pedido.ts
import { Injectable } from '@nestjs/common';
import { ConfirmarPedido, ConfirmarPedidoComando } from './confirmar-pedido';

@Injectable()
export class AprobarPedido {
  constructor(private readonly confirmar: ConfirmarPedido) {}
  ejecutar(cmd: Omit<ConfirmarPedidoComando, 'esAprobacion'>) {
    return this.confirmar.ejecutar({ ...cmd, esAprobacion: true });
  }
}
