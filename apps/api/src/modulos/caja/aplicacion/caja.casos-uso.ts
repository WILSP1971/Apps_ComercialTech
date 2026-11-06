// src/modulos/caja/aplicacion/caja.casos-uso.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { ReferenciaPago } from '../dominio/referencia-pago';

const CobroSchema = z.object({
  id: z.string().uuid(), sesionId: z.string().uuid(),
  medioPago: z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CHEQUE']),
  valor: z.number().positive(), referencia: z.string().optional(),
  facturaId: z.string().uuid().optional(), pedidoId: z.string().uuid().optional(),
});

@Injectable()
export class CajaCasosUso {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}

  /** R8: abrir sesión. La base de datos garantiza una sola abierta por caja y por usuario. */
  async abrirSesion(u: { empresaId: string; id: string }, d: { id: string; cajaId: string; montoApertura: number }) {
    try {
      await this.bd.consultar(
        `INSERT INTO caja.sesion_caja (id, empresa_id, caja_id, usuario_id, estado, monto_apertura)
         VALUES ($1,$2,$3,$4,'ABIERTA',$5) ON CONFLICT (id) DO NOTHING`, [d.id, u.empresaId, d.cajaId, u.id, d.montoApertura]);
    } catch (e: any) {
      if (e.code === '23505') throw new ErrorNegocio('R8_SESION_ABIERTA', 'Ya existe una sesión abierta para esta caja o para este usuario');
      throw e;
    }
    return {};
  }

  /** Cobro idempotente: el movimiento solo se inserta una vez por idempotencyKey. */
  async registrarCobro(u: { empresaId: string; id: string }, entrada: unknown, idempotencyKey: string) {
    const d = CobroSchema.parse(entrada);
    const ref = ReferenciaPago.crear(d.medioPago, d.referencia);                    // R10 (dominio)
    if (!ref.ok) throw new ErrorNegocio('R10_REFERENCIA_INVALIDA', ref.error);

    return this.bd.transaccion(async () => {
      const [s] = await this.bd.consultar(
        `SELECT id FROM caja.sesion_caja WHERE id=$1 AND empresa_id=$2 AND usuario_id=$3 AND estado='ABIERTA' FOR SHARE`,
        [d.sesionId, u.empresaId, u.id]);
      if (!s) throw new ErrorNegocio('SESION_NO_ABIERTA', 'No tiene una sesión de caja abierta');

      const nuevo = await this.bd.consultar(
        `INSERT INTO caja.movimiento_caja (id, empresa_id, sesion_id, tipo, sentido, medio_pago, valor, referencia,
                                           factura_id, pedido_id, idempotency_key, usuario_id)
         VALUES ($1,$2,$3,'COBRO','ENTRADA',$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [d.id, u.empresaId, d.sesionId, d.medioPago, d.valor, ref.valor.valor, d.facturaId ?? null, d.pedidoId ?? null, idempotencyKey, u.id]);
      if (nuevo.length === 0) return {};                                               // reintento: ya registrado

      await this.eventos.publicar([{
        tipo: 'caja.CobroRegistrado', agregadoId: d.id, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { movimientoId: d.id, facturaId: d.facturaId ?? null, pedidoId: d.pedidoId ?? null, valor: d.valor, medioPago: d.medioPago },
      }]);
      return {};
    });
  }

  /** R9: un error se corrige con un movimiento inverso (el trigger valida que sea exactamente inverso). */
  async reversar(u: { empresaId: string; id: string }, d: { id: string; movimientoId: string; motivo: string }) {
    return this.bd.transaccion(async () => {
      const [o] = await this.bd.consultar(
        `SELECT * FROM caja.movimiento_caja WHERE id=$1 AND empresa_id=$2`, [d.movimientoId, u.empresaId]);
      if (!o) throw new ErrorNegocio('MOVIMIENTO_NO_EXISTE', 'El movimiento no existe');
      await this.bd.consultar(
        `INSERT INTO caja.movimiento_caja (id, empresa_id, sesion_id, tipo, sentido, medio_pago, valor, referencia,
                                           factura_id, pedido_id, id_movimiento_relacionado, idempotency_key, usuario_id)
         VALUES ($1,$2,$3,'REVERSO',$4,$5,$6,$7,$8,$9,$10,$1,$11)`,
        [d.id, u.empresaId, o.sesion_id, o.sentido === 'ENTRADA' ? 'SALIDA' : 'ENTRADA', o.medio_pago, o.valor,
         `REV:${d.motivo}`.slice(0, 80), o.factura_id, o.pedido_id, o.id, u.id]);
      await this.eventos.publicar([{
        tipo: 'caja.MovimientoReversado', agregadoId: d.id, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { movimientoReversoId: d.id, movimientoOriginalId: o.id, facturaId: o.factura_id },
      }]);
      return {};
    });
  }
}
