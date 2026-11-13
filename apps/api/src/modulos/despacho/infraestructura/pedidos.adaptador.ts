// src/modulos/despacho/infraestructura/pedidos.adaptador.ts   (anti-corrupción hacia Pedidos)
import { Injectable } from '@nestjs/common';
import { PedidosApi } from '../../pedidos';
import { PedidosDespachoPuerto } from '../dominio/repositorio';

@Injectable()
export class PedidosAdaptador implements PedidosDespachoPuerto {
  constructor(private readonly api: PedidosApi) {}
  obtener(empresaId: string, pedidoId: string) { return this.api.obtenerParaDespachar(empresaId, pedidoId); }
}
