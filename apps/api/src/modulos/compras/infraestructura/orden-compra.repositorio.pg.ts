// src/modulos/compras/infraestructura/orden-compra.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { OrdenCompra } from '../dominio/orden-compra';
import { OrdenCompraRepositorio } from '../dominio/repositorios';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

@Injectable()
export class OrdenCompraRepositorioPg implements OrdenCompraRepositorio {
  constructor(private readonly bd: BaseDatos) {}

  async obtener(id: string, empresaId: string): Promise<OrdenCompra | null> {
    const [o] = await this.bd.consultar(
      `SELECT o.*, to_char(o.fecha_esperada, 'YYYY-MM-DD') AS fecha_esperada_txt
         FROM compras.orden_compra o
        WHERE o.id = $1 AND o.empresa_id = $2 AND o.eliminado_en IS NULL FOR UPDATE`, [id, empresaId]);
    if (!o) return null;
    const lineas = await this.bd.consultar(
      `SELECT * FROM compras.orden_compra_linea WHERE orden_id = $1 AND eliminado_en IS NULL ORDER BY creado_en, id`, [id]);
    return OrdenCompra.reconstituir({
      id: o.id, empresaId: o.empresa_id, proveedorId: o.proveedor_id, bodegaId: o.bodega_id,
      estado: o.estado, numero: o.numero, creadoPor: o.creado_por, aprobadoPor: o.aprobado_por,
      aprobadoEn: iso(o.aprobado_en), enviadaEn: iso(o.enviada_en), fechaEsperada: o.fecha_esperada_txt,
      motivoAnulacion: o.motivo_anulacion, observaciones: o.observaciones, version: o.version,
      lineas: lineas.map((l: any) => ({
        id: l.id, articuloId: l.articulo_id, cantidad: Number(l.cantidad),
        cantidadRecibida: Number(l.cantidad_recibida), costoUnitario: Number(l.costo_unitario),
      })),
    });
  }

  async guardar(orden: OrdenCompra): Promise<void> {
    const s = orden.snapshot;
    await this.bd.consultar(
      `INSERT INTO compras.orden_compra
         (id, empresa_id, numero, proveedor_id, bodega_id, estado, total, creado_por, aprobado_por, aprobado_en,
          enviada_en, fecha_esperada, motivo_anulacion, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET numero=$3, proveedor_id=$4, bodega_id=$5, estado=$6, total=$7, aprobado_por=$9,
         aprobado_en=$10, enviada_en=$11, fecha_esperada=$12, motivo_anulacion=$13, observaciones=$14`,
      [s.id, s.empresaId, s.numero, s.proveedorId, s.bodegaId, s.estado, orden.total(), s.creadoPor, s.aprobadoPor,
       s.aprobadoEn, s.enviadaEn, s.fechaEsperada, s.motivoAnulacion, s.observaciones]);

    // Borrado lógico de líneas retiradas (antes de insertar: el índice único por artículo ignora las eliminadas)
    await this.bd.consultar(
      `UPDATE compras.orden_compra_linea SET eliminado_en = now()
        WHERE orden_id = $1 AND eliminado_en IS NULL AND id <> ALL($2::uuid[])`, [s.id, s.lineas.map(l => l.id)]);
    for (const l of s.lineas) {
      await this.bd.consultar(
        `INSERT INTO compras.orden_compra_linea (id, empresa_id, orden_id, articulo_id, cantidad, cantidad_recibida, costo_unitario)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET articulo_id=$4, cantidad=$5, cantidad_recibida=$6, costo_unitario=$7, eliminado_en=NULL`,
        [l.id, s.empresaId, s.id, l.articuloId, l.cantidad, l.cantidadRecibida, l.costoUnitario]);
    }
  }

  async siguienteNumero(empresaId: string): Promise<string> {
    const [r] = await this.bd.consultar(
      `INSERT INTO compras.consecutivo (empresa_id, serie, ultimo) VALUES ($1,'OC',1)
       ON CONFLICT (empresa_id, serie) DO UPDATE SET ultimo = compras.consecutivo.ultimo + 1
       RETURNING ultimo`, [empresaId]);
    return `OC-${String(r.ultimo).padStart(8, '0')}`;
  }
}
