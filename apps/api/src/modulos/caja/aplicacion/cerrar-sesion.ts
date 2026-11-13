import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';

@Injectable()
export class CerrarSesionCaja {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}

  /** Cierre con arqueo: compara el efectivo contado con el esperado (apertura + entradas - salidas en efectivo). */
  async ejecutar(u: { empresaId: string; id: string },
                 d: { sesionId: string; arqueoId: string; efectivoContado: number; denominaciones?: Record<string, number>; observacion?: string }) {
    return this.bd.transaccion(async () => {
      const [s] = await this.bd.consultar(
        `SELECT id FROM caja.sesion_caja WHERE id=$1 AND empresa_id=$2 AND usuario_id=$3 AND estado='ABIERTA' FOR UPDATE`,
        [d.sesionId, u.empresaId, u.id]);
      if (!s) throw new ErrorNegocio('SESION_NO_ABIERTA', 'No tiene una sesión de caja abierta');

      const [v] = await this.bd.consultar(
        `SELECT efectivo_esperado FROM caja.v_saldo_efectivo_sesion WHERE sesion_id=$1`, [d.sesionId]);
      const esperado = Number(v.efectivo_esperado);

      await this.bd.consultar(
        `INSERT INTO caja.arqueo (id, empresa_id, sesion_id, tipo, efectivo_contado, efectivo_esperado, denominaciones, observacion, arqueado_por)
         VALUES ($1,$2,$3,'CIERRE',$4,$5,$6,$7,$8)`,
        [d.arqueoId, u.empresaId, d.sesionId, d.efectivoContado, esperado,
         d.denominaciones ? JSON.stringify(d.denominaciones) : null, d.observacion ?? null, u.id]);
      await this.bd.consultar(
        `UPDATE caja.sesion_caja
            SET estado='CERRADA', cerrada_en=now(), monto_cierre_declarado=$2, monto_cierre_sistema=$3, diferencia=$2-$3
          WHERE id=$1`, [d.sesionId, d.efectivoContado, esperado]);
      await this.eventos.publicar([{
        tipo: 'caja.SesionCerrada', agregadoId: d.sesionId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { sesionId: d.sesionId, esperado, contado: d.efectivoContado, diferencia: d.efectivoContado - esperado },
      }]);
      return { esperado, diferencia: d.efectivoContado - esperado };
    });
  }
}
