import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';

const OrdenSchema = z.object({
  id: z.string().uuid(),
  proveedorId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  lineas: z.array(z.object({
    id: z.string().uuid(), articuloId: z.string().uuid(),
    cantidad: z.number().positive(), costoUnitario: z.number().nonnegative(),
  })).min(1),
});

@Injectable()
export class ComprasCasosUso {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}

  /** Comprador: crea/edita el borrador de una orden de compra. */
  async guardarBorrador(u: { empresaId: string; id: string }, entrada: unknown) {
    const d = OrdenSchema.parse(entrada);
    const total = d.lineas.reduce((s, l) => s + l.cantidad * l.costoUnitario, 0);
    return this.bd.transaccion(async () => {
      const [o] = await this.bd.consultar(
        `SELECT estado FROM compras.orden_compra WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [d.id, u.empresaId]);
      if (o && o.estado !== 'BORRADOR') throw new ErrorNegocio('OC_NO_EDITABLE', 'Solo se edita una orden en borrador');
      await this.bd.consultar(
        `INSERT INTO compras.orden_compra (id, empresa_id, proveedor_id, bodega_id, estado, total, creado_por)
         VALUES ($1,$2,$3,$4,'BORRADOR',$5,$6)
         ON CONFLICT (id) DO UPDATE SET proveedor_id=$3, bodega_id=$4, total=$5`,
        [d.id, u.empresaId, d.proveedorId, d.bodegaId, total, u.id]);
      await this.bd.consultar(
        `UPDATE compras.orden_compra_linea SET eliminado_en=now()
          WHERE orden_id=$1 AND eliminado_en IS NULL AND id <> ALL($2::uuid[])`, [d.id, d.lineas.map(l => l.id)]);
      for (const l of d.lineas) {
        await this.bd.consultar(
          `INSERT INTO compras.orden_compra_linea (id, empresa_id, orden_id, articulo_id, cantidad, costo_unitario)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET articulo_id=$4, cantidad=$5, costo_unitario=$6, eliminado_en=NULL`,
          [l.id, u.empresaId, d.id, l.articuloId, l.cantidad, l.costoUnitario]);
      }
      return {};
    });
  }

  /** Comprador: aprueba la orden y le asigna número. */
  async aprobar(u: { empresaId: string; id: string }, ordenId: string) {
    const r = await this.bd.consultar(
      `UPDATE compras.orden_compra
          SET estado='APROBADA', aprobado_por=$3,
              numero = COALESCE(numero, 'OC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(id::text, 1, 6)))
        WHERE id=$1 AND empresa_id=$2 AND estado IN ('BORRADOR','PENDIENTE_APROBACION') RETURNING numero`,
      [ordenId, u.empresaId, u.id]);
    if (r.length === 0) throw new ErrorNegocio('OC_NO_APROBABLE', 'La orden no existe o ya fue aprobada');
    return { numero: r[0].numero };
  }

  /**
   * Bodeguero: recepción de mercadería. Actualiza PRIMERO las líneas y luego el estado (R11),
   * y publica el evento para que Inventarios ingrese el stock al kardex.
   */
  async registrarRecepcion(u: { empresaId: string; id: string },
                           d: { recepcionId: string; ordenId: string; lineas: { ordenLineaId: string; cantidad: number }[] }) {
    return this.bd.transaccion(async () => {
      const [ya] = await this.bd.consultar(`SELECT id FROM compras.recepcion WHERE id=$1 AND empresa_id=$2`, [d.recepcionId, u.empresaId]);
      if (ya) return {};                                                         // reintento idempotente

      const [orden] = await this.bd.consultar(
        `SELECT bodega_id, estado FROM compras.orden_compra WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [d.ordenId, u.empresaId]);
      if (!orden) throw new ErrorNegocio('OC_NO_EXISTE', 'La orden de compra no existe');
      if (!['APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL'].includes(orden.estado))
        throw new ErrorNegocio('OC_NO_RECIBIBLE', `No se puede recibir una orden en estado ${orden.estado}`);

      await this.bd.consultar(
        `INSERT INTO compras.recepcion (id, empresa_id, orden_id, recibido_por) VALUES ($1,$2,$3,$4)`,
        [d.recepcionId, u.empresaId, d.ordenId, u.id]);

      const detalle: any[] = [];
      for (const l of d.lineas) {
        const [x] = await this.bd.consultar(
          `UPDATE compras.orden_compra_linea SET cantidad_recibida = cantidad_recibida + $2
            WHERE id=$1 AND empresa_id=$3 AND orden_id=$4 AND cantidad_recibida + $2 <= cantidad
            RETURNING articulo_id, costo_unitario`, [l.ordenLineaId, l.cantidad, u.empresaId, d.ordenId]);
        if (!x) throw new ErrorNegocio('RECEPCION_EXCEDE_ORDEN', 'La cantidad recibida excede lo pedido en la orden');
        const recepcionLineaId = randomUUID();
        await this.bd.consultar(
          `INSERT INTO compras.recepcion_linea (id, empresa_id, recepcion_id, orden_linea_id, articulo_id, cantidad)
           VALUES ($1,$2,$3,$4,$5,$6)`, [recepcionLineaId, u.empresaId, d.recepcionId, l.ordenLineaId, x.articulo_id, l.cantidad]);
        detalle.push({ recepcionLineaId, ordenLineaId: l.ordenLineaId, articuloId: x.articulo_id,
                       cantidad: l.cantidad, costoUnitario: Number(x.costo_unitario) });
      }
      await this.bd.consultar(
        `UPDATE compras.orden_compra o
            SET estado = CASE WHEN NOT EXISTS (SELECT 1 FROM compras.orden_compra_linea
                                                WHERE orden_id=o.id AND eliminado_en IS NULL AND cantidad_recibida < cantidad)
                              THEN 'RECIBIDA' ELSE 'RECIBIDA_PARCIAL' END
          WHERE id=$1`, [d.ordenId]);
      await this.eventos.publicar([{
        tipo: 'compras.RecepcionRegistrada', agregadoId: d.recepcionId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { recepcionId: d.recepcionId, ordenId: d.ordenId, bodegaId: orden.bodega_id, lineas: detalle },
      }]);
      return {};
    });
  }

  /** R11: cerrar la orden. Si falta mercadería, el trigger trg_r11_cierre_oc lo rechaza (SQLSTATE 23514). */
  async cerrar(u: { empresaId: string }, ordenId: string) {
    try {
      const r = await this.bd.consultar(
        `UPDATE compras.orden_compra SET estado='CERRADA'
          WHERE id=$1 AND empresa_id=$2 AND estado IN ('RECIBIDA','RECIBIDA_PARCIAL') RETURNING id`, [ordenId, u.empresaId]);
      if (r.length === 0) throw new ErrorNegocio('OC_NO_CERRABLE', 'La orden no existe o no tiene recepciones');
    } catch (e: any) {
      if (e.code === '23514') throw new ErrorNegocio('R11_OC_SIN_RECIBIR', 'No se puede cerrar la orden: hay mercadería sin recibir');
      throw e;
    }
    return {};
  }
}
