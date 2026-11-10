// src/modulos/despacho/infraestructura/inventarios.adaptador.ts   (anti-corrupción hacia Inventarios)
import { Injectable } from '@nestjs/common';
import { InventariosApi } from '../../inventarios';
import { InventariosDespachoPuerto } from '../dominio/repositorio';

@Injectable()
export class InventariosAdaptador implements InventariosDespachoPuerto {
  constructor(private readonly api: InventariosApi) {}

  async reservasActivas(empresaId: string, pedidoId: string) {
    const r = await this.api.reservasActivas(empresaId, pedidoId);
    return r.map(x => ({ id: x.id, pedidoLineaId: x.pedido_linea_id, articuloId: x.articulo_id, cantidad: Number(x.cantidad) }));
  }
  consumirReservas(c: Parameters<InventariosDespachoPuerto['consumirReservas']>[0]) { return this.api.consumirReservas(c); }
}
