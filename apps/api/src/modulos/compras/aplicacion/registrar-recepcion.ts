// src/modulos/compras/aplicacion/registrar-recepcion.ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import {
  ORDEN_COMPRA_REPOSITORIO, OrdenCompraRepositorio, RECEPCION_REPOSITORIO, RecepcionRepositorio,
} from '../dominio/repositorios';

export const RecepcionSchema = z.object({
  recepcionId: z.string().uuid(),
  ordenId: z.string().uuid(),
  observaciones: z.string().max(500).optional(),
  lineas: z.array(z.object({ ordenLineaId: z.string().uuid(), cantidad: z.number().positive() })).min(1),
});

@Injectable()
export class RegistrarRecepcion {
  constructor(
    @Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio,
    @Inject(RECEPCION_REPOSITORIO) private readonly recepciones: RecepcionRepositorio,
    private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos,
  ) {}

  /**
   * Bodeguero. Idempotente por recepcionId (un reintento offline no duplica el ingreso).
   * El agregado valida todas las líneas; luego se guardan orden y recepción y se publica el evento
   * que Inventarios convierte en asientos de kardex (ENTRADA_COMPRA).
   */
  async ejecutar(u: { empresaId: string; id: string }, entrada: unknown) {
    const d = RecepcionSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      if (await this.recepciones.existe(d.recepcionId, u.empresaId)) return {};

      const orden = await this.ordenes.obtener(d.ordenId, u.empresaId);
      if (!orden) throw new ErrorNegocio('OC_NO_EXISTE', 'La orden de compra no existe');

      const detalle = lanzarSiFalla(orden.registrarRecepcion(
        d.recepcionId, d.lineas.map(l => ({ ...l, recepcionLineaId: randomUUID() }))));

      await this.ordenes.guardar(orden);                      // actualiza cantidad_recibida y estado
      await this.recepciones.guardar({
        id: d.recepcionId, empresaId: u.empresaId, ordenId: d.ordenId, recibidoPor: u.id,
        observaciones: d.observaciones ?? null, detalle,
      });
      await this.eventos.publicar(orden.extraerEventos());
      return { estado: orden.estado };
    });
  }
}
