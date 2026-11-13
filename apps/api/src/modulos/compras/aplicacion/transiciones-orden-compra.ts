// src/modulos/compras/aplicacion/transiciones-orden-compra.ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import { OrdenCompra } from '../dominio/orden-compra';
import { ORDEN_COMPRA_REPOSITORIO, OrdenCompraRepositorio } from '../dominio/repositorios';

async function cargar(repo: OrdenCompraRepositorio, id: string, empresaId: string): Promise<OrdenCompra> {
  const o = await repo.obtener(id, empresaId);
  if (!o) throw new ErrorNegocio('OC_NO_EXISTE', 'La orden de compra no existe');
  return o;
}

@Injectable()
export class EnviarAAprobacionOrdenCompra {
  constructor(@Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio, private readonly bd: BaseDatos) {}
  ejecutar(u: { empresaId: string }, ordenId: string) {
    return this.bd.transaccion(async () => {
      const o = await cargar(this.ordenes, ordenId, u.empresaId);
      if (o.estado === 'PENDIENTE_APROBACION') return {};                      // idempotente
      lanzarSiFalla(o.enviarAAprobacion());
      await this.ordenes.guardar(o);
      return {};
    });
  }
}

@Injectable()
export class AprobarOrdenCompra {
  constructor(
    @Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio,
    private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos,
  ) {}

  ejecutar(u: { empresaId: string; id: string }, ordenId: string) {
    return this.bd.transaccion(async () => {
      const o = await cargar(this.ordenes, ordenId, u.empresaId);
      if (['APROBADA', 'ENVIADA'].includes(o.estado) && o.numero) return { numero: o.numero };   // idempotente
      const numero = o.numero ?? await this.ordenes.siguienteNumero(u.empresaId);
      const umbral = Number(process.env.OC_UMBRAL_SEGREGACION ?? 5_000_000);
      lanzarSiFalla(o.aprobar(u.id, numero, { umbralSegregacion: umbral }));
      await this.ordenes.guardar(o);
      await this.eventos.publicar(o.extraerEventos());
      return { numero };
    });
  }
}

@Injectable()
export class EnviarOrdenCompra {
  constructor(@Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio, private readonly bd: BaseDatos) {}
  ejecutar(u: { empresaId: string }, ordenId: string) {
    return this.bd.transaccion(async () => {
      const o = await cargar(this.ordenes, ordenId, u.empresaId);
      if (o.estado === 'ENVIADA') return {};                                   // idempotente
      lanzarSiFalla(o.marcarEnviada());
      await this.ordenes.guardar(o);
      return {};
    });
  }
}

@Injectable()
export class CerrarOrdenCompra {
  constructor(
    @Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio,
    private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos,
  ) {}

  /** R11. El dominio lo valida con un mensaje claro; el trigger trg_r11_cierre_oc es el último guardián. */
  async ejecutar(u: { empresaId: string }, ordenId: string) {
    try {
      return await this.bd.transaccion(async () => {
        const o = await cargar(this.ordenes, ordenId, u.empresaId);
        if (o.estado === 'CERRADA') return {};                                 // idempotente
        lanzarSiFalla(o.cerrar());
        await this.ordenes.guardar(o);
        await this.eventos.publicar(o.extraerEventos());
        return {};
      });
    } catch (e: any) {
      if (e.code === '23514') throw new ErrorNegocio('R11_OC_SIN_RECIBIR', 'No se puede cerrar la orden: hay mercadería sin recibir');
      throw e;
    }
  }
}

@Injectable()
export class AnularOrdenCompra {
  constructor(
    @Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio,
    private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos,
  ) {}
  ejecutar(u: { empresaId: string }, ordenId: string, entrada: unknown) {
    const { motivo } = z.object({ motivo: z.string().min(5) }).parse(entrada);
    return this.bd.transaccion(async () => {
      const o = await cargar(this.ordenes, ordenId, u.empresaId);
      if (o.estado === 'ANULADA') return {};                                   // idempotente
      lanzarSiFalla(o.anular(motivo));
      await this.ordenes.guardar(o);
      await this.eventos.publicar(o.extraerEventos());
      return {};
    });
  }
}
