// src/modulos/despacho/aplicacion/transiciones-despacho.ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import { Despacho } from '../dominio/despacho';
import { DESPACHO_REPOSITORIO, DespachoRepositorio } from '../dominio/repositorio';

async function cargar(repo: DespachoRepositorio, id: string, empresaId: string): Promise<Despacho> {
  const d = await repo.obtener(id, empresaId);
  if (!d) throw new ErrorNegocio('DESPACHO_NO_EXISTE', 'El despacho no existe');
  return d;
}

const EntregaSchema = z.object({
  despachoId: z.string().uuid(),
  receptor: z.string().min(3),
  evidenciaUrl: z.string().url().optional(),
});
const FalloSchema = z.object({ despachoId: z.string().uuid(), motivo: z.string().min(5) });
const IdSchema = z.object({ despachoId: z.string().uuid() });
const CancelarSchema = z.object({ despachoId: z.string().uuid(), motivo: z.string().min(5) });
const LogisticaSchema = z.object({
  despachoId: z.string().uuid(),
  transportador: z.string().max(80).nullable().optional(),
  guia: z.string().max(60).nullable().optional(),
  fechaProgramada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  direccionEntrega: z.string().min(5).optional(),
});

@Injectable()
export class RegistrarEntrega {
  constructor(@Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio, private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}
  ejecutar(u: { empresaId: string }, entrada: unknown) {
    const d = EntregaSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const despacho = await cargar(this.despachos, d.despachoId, u.empresaId);
      if (despacho.estado === 'ENTREGADO') return {};                               // idempotente
      lanzarSiFalla(despacho.registrarEntrega({ receptor: d.receptor, evidenciaUrl: d.evidenciaUrl }));
      await this.despachos.guardar(despacho);
      await this.eventos.publicar(despacho.extraerEventos());
      return {};
    });
  }
}

@Injectable()
export class RegistrarEntregaFallida {
  constructor(@Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio, private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}
  ejecutar(u: { empresaId: string }, entrada: unknown) {
    const d = FalloSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const despacho = await cargar(this.despachos, d.despachoId, u.empresaId);
      if (despacho.estado === 'FALLIDO') return {};                                 // idempotente
      lanzarSiFalla(despacho.registrarEntregaFallida(d.motivo));
      await this.despachos.guardar(despacho);
      await this.eventos.publicar(despacho.extraerEventos());
      return {};
    });
  }
}

@Injectable()
export class ReintentarEntrega {
  constructor(@Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio, private readonly bd: BaseDatos) {}
  ejecutar(u: { empresaId: string }, entrada: unknown) {
    const d = IdSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const despacho = await cargar(this.despachos, d.despachoId, u.empresaId);
      lanzarSiFalla(despacho.reintentarEntrega());
      await this.despachos.guardar(despacho);
      return {};
    });
  }
}

@Injectable()
export class CancelarDespacho {
  constructor(@Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio, private readonly bd: BaseDatos) {}
  ejecutar(u: { empresaId: string }, entrada: unknown) {
    const d = CancelarSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const despacho = await cargar(this.despachos, d.despachoId, u.empresaId);
      if (despacho.estado === 'CANCELADO') return {};                               // idempotente
      lanzarSiFalla(despacho.cancelar(d.motivo));
      await this.despachos.guardar(despacho);                                        // libera las reservas para otro despacho
      return {};
    });
  }
}

@Injectable()
export class ActualizarLogisticaDespacho {
  constructor(@Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio, private readonly bd: BaseDatos) {}
  ejecutar(u: { empresaId: string }, entrada: unknown) {
    const { despachoId, ...datos } = LogisticaSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const despacho = await cargar(this.despachos, despachoId, u.empresaId);
      lanzarSiFalla(despacho.actualizarLogistica(datos));
      await this.despachos.guardar(despacho);
      return {};
    });
  }
}
