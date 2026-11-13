// src/modulos/despacho/aplicacion/despachar-pedido.ts
import { Inject, Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import {
  DESPACHO_REPOSITORIO, DespachoRepositorio, INVENTARIOS_DESPACHO_PUERTO, InventariosDespachoPuerto,
  PEDIDOS_DESPACHO_PUERTO, PedidosDespachoPuerto,
} from '../dominio/repositorio';
import { ProgramarDespacho } from './programar-despacho';

@Injectable()
export class DespacharPedido {
  constructor(
    @Inject(DESPACHO_REPOSITORIO) private readonly despachos: DespachoRepositorio,
    @Inject(INVENTARIOS_DESPACHO_PUERTO) private readonly inventarios: InventariosDespachoPuerto,
    @Inject(PEDIDOS_DESPACHO_PUERTO) private readonly pedidos: PedidosDespachoPuerto,
    private readonly programar: ProgramarDespacho,
    private readonly bd: BaseDatos,
    private readonly eventos: PublicadorEventos,
  ) {}

  /**
   * Bodeguero. R12: sin reserva ACTIVA no hay salida de mercadería.
   * Sirve para despachar uno ya programado o, en un solo paso (como el comando offline), programar y despachar.
   * Idempotente: repetir la operación sobre un despacho ya despachado no vuelve a mover inventario.
   */
  async ejecutar(u: { empresaId: string; id: string }, entrada: unknown) {
    return this.bd.transaccion(async () => {
      const despacho = await this.programar.ejecutar(u, entrada);        // devuelve el existente o crea uno nuevo
      if (despacho.estado !== 'PROGRAMADO') {
        if (['DESPACHADO', 'ENTREGADO', 'FALLIDO'].includes(despacho.estado))
          return { despachoId: despacho.id, numero: despacho.numero, estado: despacho.estado };      // ya despachado
        throw new ErrorNegocio('DESPACHO_ESTADO_INVALIDO', `No se puede despachar un despacho ${despacho.estado}`);
      }

      // R12: consumir reservas ACTIVAS (si alguna dejó de estarlo, se rechaza todo el despacho)
      await this.inventarios.consumirReservas({
        empresaId: u.empresaId, reservaIds: despacho.lineas.map(l => l.reservaId), despachoId: despacho.id, usuarioId: u.id,
      });

      // ¿Queda el pedido totalmente despachado? (cantidad ya despachada + este despacho >= cantidad pedida)
      const pedido = await this.pedidos.obtener(u.empresaId, despacho.pedidoId);
      const yaDespachado = await this.despachos.despachadoPorLinea(u.empresaId, despacho.pedidoId);
      const esteDespacho = new Map<string, number>();
      for (const l of despacho.lineas) esteDespacho.set(l.pedidoLineaId, (esteDespacho.get(l.pedidoLineaId) ?? 0) + l.cantidad);
      const completo = !!pedido && pedido.lineas.every(l =>
        (yaDespachado.get(l.id) ?? 0) + (esteDespacho.get(l.id) ?? 0) >= l.cantidad);

      lanzarSiFalla(despacho.despachar(u.id, completo));
      await this.despachos.guardar(despacho);
      await this.eventos.publicar(despacho.extraerEventos());
      return { despachoId: despacho.id, numero: despacho.numero, estado: despacho.estado, completo };
    });
  }
}
