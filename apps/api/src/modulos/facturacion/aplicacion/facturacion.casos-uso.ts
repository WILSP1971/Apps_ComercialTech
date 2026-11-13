// src/modulos/facturacion/aplicacion/facturacion.casos-uso.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { PedidosApi } from '../../pedidos';                    // API pública de Pedidos

@Injectable()
export class FacturacionCasosUso {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos, private readonly pedidos: PedidosApi) {}

  /** Contador: emite la factura de un pedido confirmado. R14: el número se toma en la MISMA transacción. */
  async emitir(u: { empresaId: string; id: string }, d: { facturaId: string; pedidoId: string; prefijo: string }) {
    return this.bd.transaccion(async () => {
      const [ya] = await this.bd.consultar(
        `SELECT id, prefijo, numero FROM facturacion.factura WHERE empresa_id=$1 AND pedido_id=$2 AND estado<>'ANULADA'`, [u.empresaId, d.pedidoId]);
      if (ya) return { facturaId: ya.id, numero: `${ya.prefijo}${ya.numero}` };            // idempotente

      const p = await this.pedidos.obtenerParaFacturar(u.empresaId, d.pedidoId);
      if (!p) throw new ErrorNegocio('PEDIDO_NO_FACTURABLE', 'El pedido no existe o no está confirmado');

      const [serie] = await this.bd.consultar(
        `SELECT id FROM facturacion.serie_documento WHERE empresa_id=$1 AND tipo='FACTURA' AND prefijo=$2`, [u.empresaId, d.prefijo]);
      if (!serie) throw new ErrorNegocio('SERIE_NO_EXISTE', 'La serie de facturación no existe');

      // R14: UPDATE ... RETURNING con bloqueo de fila. Si algo falla más abajo, el ROLLBACK devuelve el número.
      const [{ n }] = await this.bd.consultar(`SELECT facturacion.siguiente_numero($1,'FACTURA',$2) AS n`, [u.empresaId, d.prefijo]);

      const dias = p.condicionPago === 'CREDITO' ? 30 : 0;      // en un sistema real: plazo del cliente
      await this.bd.consultar(
        `INSERT INTO facturacion.factura (id, empresa_id, serie_id, prefijo, numero, pedido_id, cliente_id,
                                          subtotal, impuestos, total, saldo, fecha_vencimiento, emitida_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, current_date + $11::int, $12)`,
        [d.facturaId, u.empresaId, serie.id, d.prefijo, n, d.pedidoId, p.clienteId, p.subtotal, p.impuestos, p.total, dias, u.id]);
      for (const l of p.lineas) {
        await this.bd.consultar(
          `INSERT INTO facturacion.factura_linea (id, empresa_id, factura_id, articulo_id, descripcion, cantidad, precio_unitario, iva_pct, total_linea)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8)`,
          [u.empresaId, d.facturaId, l.articuloId, l.descripcion, l.cantidad, l.precioUnitario, l.ivaPct, l.totalLinea]);
      }
      await this.eventos.publicar([{
        tipo: 'facturacion.FacturaEmitida', agregadoId: d.facturaId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { facturaId: d.facturaId, pedidoId: d.pedidoId, clienteId: p.clienteId, total: p.total, prefijo: d.prefijo, numero: Number(n) },
      }]);
      return { facturaId: d.facturaId, numero: `${d.prefijo}${n}` };
    });
  }

  /** R6: una factura emitida no se borra; se anula con una nota de crédito (también numerada sin saltos). */
  async anular(u: { empresaId: string; id: string }, d: { notaId: string; facturaId: string; prefijoNc: string; motivo: string }) {
    return this.bd.transaccion(async () => {
      const [f] = await this.bd.consultar(
        `SELECT * FROM facturacion.factura WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [d.facturaId, u.empresaId]);
      if (!f) throw new ErrorNegocio('FACTURA_NO_EXISTE', 'La factura no existe');
      if (f.estado === 'ANULADA') return {};                                              // idempotente
      const [{ pagos }] = await this.bd.consultar(
        `SELECT count(*)::int AS pagos FROM facturacion.pago_factura WHERE factura_id=$1 AND estado='APLICADO'`, [d.facturaId]);
      if (pagos > 0) throw new ErrorNegocio('FACTURA_CON_PAGOS', 'Reverse primero los pagos aplicados en caja (R9)');

      const [{ n }] = await this.bd.consultar(`SELECT facturacion.siguiente_numero($1,'NOTA_CREDITO',$2) AS n`, [u.empresaId, d.prefijoNc]);
      await this.bd.consultar(
        `INSERT INTO facturacion.nota_credito (id, empresa_id, factura_id, prefijo, numero, tipo, motivo, total, emitida_por)
         VALUES ($1,$2,$3,$4,$5,'ANULACION_TOTAL',$6,$7,$8)`,
        [d.notaId, u.empresaId, d.facturaId, d.prefijoNc, n, d.motivo, f.total, u.id]);
      await this.bd.consultar(`UPDATE facturacion.factura SET estado='ANULADA', saldo=0 WHERE id=$1`, [d.facturaId]);
      await this.eventos.publicar([{
        tipo: 'facturacion.FacturaAnulada', agregadoId: d.facturaId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { facturaId: d.facturaId, pedidoId: f.pedido_id, notaCreditoId: d.notaId },
      }]);
      return {};
    });
  }
}
