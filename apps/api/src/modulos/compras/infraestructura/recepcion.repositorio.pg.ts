// src/modulos/compras/infraestructura/recepcion.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { RecepcionRepositorio } from '../dominio/repositorios';

@Injectable()
export class RecepcionRepositorioPg implements RecepcionRepositorio {
  constructor(private readonly bd: BaseDatos) {}

  async existe(id: string, empresaId: string): Promise<boolean> {
    const r = await this.bd.consultar(`SELECT 1 FROM compras.recepcion WHERE id=$1 AND empresa_id=$2`, [id, empresaId]);
    return r.length > 0;
  }

  async guardar(r: Parameters<RecepcionRepositorio['guardar']>[0]): Promise<void> {
    await this.bd.consultar(
      `INSERT INTO compras.recepcion (id, empresa_id, orden_id, recibido_por, observaciones) VALUES ($1,$2,$3,$4,$5)`,
      [r.id, r.empresaId, r.ordenId, r.recibidoPor, r.observaciones]);
    for (const l of r.detalle) {
      await this.bd.consultar(
        `INSERT INTO compras.recepcion_linea (id, empresa_id, recepcion_id, orden_linea_id, articulo_id, cantidad)
         VALUES ($1,$2,$3,$4,$5,$6)`, [l.recepcionLineaId, r.empresaId, r.id, l.ordenLineaId, l.articuloId, l.cantidad]);
    }
  }
}
