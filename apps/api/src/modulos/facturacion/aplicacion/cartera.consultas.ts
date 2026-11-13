import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';

@Injectable()
export class CarteraConsultas {
  constructor(private readonly bd: BaseDatos) {}

  /** Cartera = saldo pendiente de las facturas (R7: saldo = total - pagos aplicados). */
  pendiente(empresaId: string, soloVencida = false) {
    return this.bd.consultar(
      `SELECT f.id, f.cliente_id, f.prefijo || f.numero::text AS factura, f.total, f.saldo, f.fecha_vencimiento,
              GREATEST(current_date - f.fecha_vencimiento, 0) AS dias_mora
         FROM facturacion.factura f
        WHERE f.empresa_id=$1 AND f.saldo > 0 AND f.estado <> 'ANULADA'
          AND ($2::boolean = false OR f.fecha_vencimiento < current_date)
        ORDER BY f.fecha_vencimiento`, [empresaId, soloVencida]);
  }
}
