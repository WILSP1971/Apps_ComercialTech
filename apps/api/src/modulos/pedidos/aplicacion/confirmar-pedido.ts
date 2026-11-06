// src/modulos/pedidos/aplicacion/confirmar-pedido.ts
import { Inject, Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import {
  CLIENTE_CREDITO_REPOSITORIO, ClienteCreditoRepositorio, PEDIDO_REPOSITORIO, PedidoRepositorio,
} from '../dominio/pedido';
import { INVENTARIOS_PUERTO, InventariosPuerto } from './puertos';

export interface ConfirmarPedidoComando {
  empresaId: string; pedidoId: string; usuarioId: string;
  esAprobacion?: boolean;          // true cuando lo ejecuta el supervisor (salta el control R13)
}
export interface ResultadoConfirmacion { estado: 'CONFIRMADO' | 'PENDIENTE_APROBACION'; numero?: string }

@Injectable()
export class ConfirmarPedido {
  constructor(
    @Inject(PEDIDO_REPOSITORIO) private readonly pedidos: PedidoRepositorio,
    @Inject(CLIENTE_CREDITO_REPOSITORIO) private readonly clientes: ClienteCreditoRepositorio,
    @Inject(INVENTARIOS_PUERTO) private readonly inventarios: InventariosPuerto,
    private readonly bd: BaseDatos,
    private readonly eventos: PublicadorEventos,
  ) {}

  async ejecutar(cmd: ConfirmarPedidoComando): Promise<ResultadoConfirmacion> {
    return this.bd.transaccion(async () => {
      const pedido = await this.pedidos.obtener(cmd.pedidoId, cmd.empresaId);
      if (!pedido) throw new ErrorNegocio('PEDIDO_NO_EXISTE', 'El pedido no existe');

      // Idempotencia natural: un pedido ya confirmado devuelve el mismo resultado
      if (pedido.estado === 'CONFIRMADO' && pedido.numero) return { estado: 'CONFIRMADO', numero: pedido.numero };
      if (cmd.esAprobacion && pedido.estado !== 'PENDIENTE_APROBACION')
        throw new ErrorNegocio('PEDIDO_NO_PENDIENTE', 'El pedido no está pendiente de aprobación');

      const cliente = await this.clientes.obtener(pedido.snapshot.clienteId, cmd.empresaId);
      if (!cliente) throw new ErrorNegocio('CLIENTE_NO_EXISTE', 'El cliente no existe en Pedidos');

      // ---- R13: control de crédito ----
      const veredicto = pedido.evaluarCredito(cliente);
      if (veredicto === 'BLOQUEADO') throw new ErrorNegocio('CLIENTE_BLOQUEADO', 'El cliente está bloqueado para crédito');
      if (veredicto === 'REQUIERE_APROBACION' && !cmd.esAprobacion) {
        const excedido = pedido.total().valor - cliente.disponible;
        const r = pedido.enviarAAprobacion(excedido);
        if (!r.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', r.error);
        await this.pedidos.guardar(pedido);
        await this.eventos.publicar(pedido.extraerEventos());
        return { estado: 'PENDIENTE_APROBACION' };      // no es un error: el supervisor debe decidir
      }

      // ---- R2 y R3: reservar por línea lo que haya disponible (misma transacción, FOR UPDATE) ----
      const reservas = [];
      for (const l of pedido.lineas) {
        const r = await this.inventarios.reservar({
          empresaId: cmd.empresaId, articuloId: l.articuloId, bodegaId: pedido.snapshot.bodegaId,
          cantidad: l.cantidad, pedidoId: pedido.id, pedidoLineaId: l.id, usuarioId: cmd.usuarioId,
        });
        reservas.push({ lineaId: l.id, reservada: r.reservada });
      }

      // ---- R1: el dominio calcula el faltante y emite el evento hacia Fabricación ----
      const numero = await this.pedidos.siguienteNumero(cmd.empresaId, 'PED');
      const c = pedido.confirmar(numero, reservas);
      if (!c.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', c.error);

      if (pedido.snapshot.condicionPago === 'CREDITO') {
        const consumo = cliente.consumir(pedido.total().valor);
        if (!consumo.ok) throw new ErrorNegocio('CLIENTE_BLOQUEADO', consumo.error);
        await this.clientes.guardar(cliente);
      }
      await this.pedidos.guardar(pedido);
      await this.eventos.publicar(pedido.extraerEventos());    // misma transacción => outbox
      return { estado: 'CONFIRMADO', numero };
    });
  }
}
