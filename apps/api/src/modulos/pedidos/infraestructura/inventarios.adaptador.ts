// src/modulos/pedidos/infraestructura/inventarios.adaptador.ts   (anti-corrupción hacia el otro módulo)
import { Injectable } from '@nestjs/common';
import { InventariosApi } from '../../inventarios';            // solo la API pública (index.ts)
import { InventariosPuerto } from '../aplicacion/puertos';

@Injectable()
export class InventariosAdaptador implements InventariosPuerto {
  constructor(private readonly api: InventariosApi) {}
  async reservar(c: Parameters<InventariosPuerto['reservar']>[0]) {
    const r = await this.api.reservar({ ...c, origen: 'inicial' });
    return { reservada: r.reservada };
  }
}
