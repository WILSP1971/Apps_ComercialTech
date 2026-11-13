// src/modulos/despacho/aplicacion/programar-despacho.ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import { Despacho } from '../dominio/despacho';
import {
  DESPACHO_REPOSITORIO, DespachoRepositorio, INVENTARIOS_DESPACHO_PUERTO, InventariosDespachoPuerto,
  PEDIDOS_DESPACHO_PUERTO, PedidosDespachoPuerto,
} from '../dominio/repositorio';

export const ProgramarDespachoSchema = z.object({
  despachoId: z.string().uuid(),
  pedidoId: z.string().uuid(),
  direccionEntrega: z.string().min(5).optional(),
  transportador: z.string().max(80).optional(),
  guia: z.string().max(60).optional(),
  fechaProgramada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pedidoLineaIds: z.array(z.string().uuid()).optional(),       // despacho parcial: solo estas líneas
});
export type ProgramarDespachoEntrada = z.infer<typeof ProgramarDespachoSchema>;

@Injectable()
export class ProgramarDespacho {
  constructor(
    @Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio,
    @Inject(INVENTARIOS_DESPACHO_PUERTO) private readonly inventarios: InventariosDespachoPuerto,
    @Inject(PEDIDOS_DESPACHO_PUERTO) private readonly pedidos: PedidosDespachoPuerto,
    private readonly bd: BaseDatos,
  ) {}

  /**
   * Programa el despacho con las reservas ACTIVAS del pedido que aún no están asignadas a otro despacho.
   * Idempotente por despachoId. R12: si no hay reservas activas disponibles, no hay despacho.
   * Debe ejecutarse dentro de una transacción (lo invocan casos de uso que ya la abren).
   */
  async ejecutar(u: { empresaId: string; id: string }, entrada: unknown): Promise<Despacho> {
    const d = ProgramarDespachoSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const previo = await this.despachos.obtener(d.despachoId, u.empresaId);
      if (previo) return previo;

      const pedido = await this.pedidos.obtener(u.empresaId, d.pedidoId);
      if (!pedido) throw new ErrorNegocio('PEDIDO_NO_EXISTE', 'El pedido no existe');
      if (pedido.estado !== 'CONFIRMADO')
        throw new ErrorNegocio('PEDIDO_NO_DESPACHABLE', `Solo se despacha un pedido confirmado (estado actual: ${pedido.estado})`);

      const asignadas = await this.despachos.reservasAsignadas(u.empresaId, d.pedidoId);
      const activas = (await this.inventarios.reservasActivas(u.empresaId, d.pedidoId))
        .filter(r => !asignadas.has(r.id))
        .filter(r => !d.pedidoLineaIds || d.pedidoLineaIds.includes(r.pedidoLineaId));

      const nuevo = lanzarSiFalla(Despacho.programar({
        id: d.despachoId, empresaId: u.empresaId, pedidoId: d.pedidoId, clienteId: pedido.clienteId, bodegaId: pedido.bodegaId,
        direccionEntrega: d.direccionEntrega ?? pedido.direccionEntrega ?? '',
        transportador: d.transportador ?? null, guia: d.guia ?? null, fechaProgramada: d.fechaProgramada ?? null,
        lineas: activas.map(r => ({
          id: randomUUID(), pedidoLineaId: r.pedidoLineaId, articuloId: r.articuloId, cantidad: r.cantidad, reservaId: r.id,
        })),
      }));
      nuevo.asignarNumero(await this.despachos.siguienteNumero(u.empresaId));
      await this.despachos.guardar(nuevo);
      return nuevo;
    });
  }
}
